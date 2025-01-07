import { Injectable, OnModuleInit } from '@nestjs/common';
import * as dbus from 'dbus-next';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private systemBus;
  private bluez;

  constructor() {
    try {
      this.systemBus = dbus.systemBus();
      if (!this.systemBus) {
        throw new Error('Failed to initialize systemBus');
      }
    } catch (error) {
      console.error('DBus initialization error:', error);
    }
  }

  async onModuleInit() {
    console.log('Initializing BlueZ interface...');
    try {
      const bluez = await this.systemBus.getProxyObject('org.bluez', '/');
      this.bluez = bluez.getInterface('org.freedesktop.DBus.ObjectManager');
      console.log('BlueZ interface initialized successfully');

      // Спроба підключення до першого пристрою
      await this.connectToFirstDevice();
    } catch (error) {
      console.error('Failed to initialize BlueZ interface:', error);
    }
  }

  async connectToFirstDevice() {
    console.log('Listing devices...');
    try {
      const objects = await this.bluez.GetManagedObjects();
      const devices = Object.keys(objects).filter((path) =>
        path.includes('/org/bluez/hci0/dev_')
      );
      console.log('Discovered devices:', devices);

      if (devices.length === 0) {
        console.warn('No devices found.');
        return;
      }

      const devicePath = devices[0];
      console.log('Attempting to connect to the first device:', devicePath);

      const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);
      const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');

      console.log('Connecting to device using retry logic...');
      await this.connectWithRetry(deviceInterface, 3, 2000);
      console.log('Device connected successfully.');

      console.log('Reading characteristics...');
      await this.readDeviceCharacteristics(deviceProxy, objects);

      console.log('Reading battery level...');
      await this.readBatteryLevel(deviceProxy, objects);
    } catch (error) {
      console.error('Failed to connect to device:', error);
    }
  }

  async connectWithRetry(deviceInterface, retries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Attempt ${attempt} to connect to the device...`);
        await deviceInterface.Connect();
        console.log('Device connected successfully.');
        return;
      } catch (error) {
        console.error(`Connection attempt ${attempt} failed:`, error);
        if (attempt < retries) {
          console.log(`Retrying in ${delay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.error('All connection attempts failed.');
          throw error;
        }
      }
    }
  }

  async readDeviceCharacteristics(deviceProxy, objects) {
    console.log('Reading device characteristics...');
    try {
      const deviceProperties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
      const servicesResolved = await deviceProperties.Get('org.bluez.Device1', 'ServicesResolved');

      if (!servicesResolved.value) {
        console.warn('Services are not resolved yet.');
        return;
      }

      const services = Object.keys(objects).filter((path) =>
        path.startsWith(deviceProxy.path) && path.includes('service')
      );
      console.log('Discovered GATT services:', services);

      for (const servicePath of services) {
        if (!objects[servicePath]['org.bluez.GattService1']) continue;

        console.log(`Inspecting service: ${servicePath}`);
        const serviceProxy = await this.systemBus.getProxyObject('org.bluez', servicePath);
        const serviceProperties = serviceProxy.getInterface('org.freedesktop.DBus.Properties');
        const uuid = await serviceProperties.Get('org.bluez.GattService1', 'UUID');
        console.log(`Service ${servicePath} UUID: ${uuid.value}`);

        const characteristics = Object.keys(objects).filter((path) =>
          path.startsWith(servicePath) && path.includes('char')
        );
        console.log(`Discovered characteristics for service ${servicePath}:`, characteristics);

        for (const charPath of characteristics) {
          if (!objects[charPath]['org.bluez.GattCharacteristic1']) continue;

          console.log(`Inspecting characteristic: ${charPath}`);
          try {
            const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
            const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');

            const charProperties = charProxy.getInterface('org.freedesktop.DBus.Properties');
            const flags = await charProperties.Get('org.bluez.GattCharacteristic1', 'Flags');

            if (flags.value.includes('read')) {
              const value = await charInterface.ReadValue({});
              console.log(`Value of characteristic ${charPath}:`, this.bufferToUtf8(value));
            }

            if (flags.value.includes('notify')) {
              await charInterface.StartNotify();
              console.log(`Subscribed to notifications for characteristic ${charPath}`);
              this.subscribeToNotifications(charPath, charInterface);
            }
          } catch (error) {
            console.error(`Error processing characteristic ${charPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to read device characteristics:', error);
    }
  }

  async readBatteryLevel(deviceProxy, objects) {
    console.log('Reading Battery Level...');
    try {
      const batteryServicePath = Object.keys(objects).find(
        (path) =>
          path.startsWith(deviceProxy.path) &&
          objects[path]['org.bluez.GattService1'] &&
          objects[path]['org.freedesktop.DBus.Properties'].UUID ===
          '0000180f-0000-1000-8000-00805f9b34fb'
      );

      if (!batteryServicePath) {
        console.warn('Battery Service not found.');
        return;
      }

      const batteryCharPath = Object.keys(objects).find(
        (path) =>
          path.startsWith(batteryServicePath) &&
          objects[path]['org.bluez.GattCharacteristic1'] &&
          objects[path]['org.freedesktop.DBus.Properties'].UUID ===
          '00002a19-0000-1000-8000-00805f9b34fb'
      );

      if (!batteryCharPath) {
        console.warn('Battery Level Characteristic not found.');
        return;
      }

      const charProxy = await this.systemBus.getProxyObject('org.bluez', batteryCharPath);
      const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');
      const value = await charInterface.ReadValue({});
      console.log(`Battery Level: ${this.bufferToInt(value)}%`);
    } catch (error) {
      console.error('Failed to read battery level:', error);
    }
  }

  private async subscribeToNotifications(charPath: string, charInterface: any) {
    try {
      charInterface.on('PropertiesChanged', (iface, changed, invalidated) => {
        if (changed.Value) {
          console.log(
            `Notification from ${charPath}:`,
            this.bufferToUtf8(Buffer.from(changed.Value.value))
          );
        }
      });
    } catch (error) {
      console.error(`Failed to subscribe to notifications for ${charPath}:`, error);
    }
  }

  private bufferToHex(buffer: Buffer): string {
    return buffer.toString('hex').toUpperCase();
  }

  private bufferToUtf8(buffer: Buffer): string {
    return buffer.toString('utf8');
  }

  private bufferToInt(buffer: Buffer): number {
    return buffer.readUInt8(0);
  }
}
