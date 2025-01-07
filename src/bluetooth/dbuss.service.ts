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

  private async log(message: string, devicePath: string, ...optionalParams: any[]) {
    const deviceName = await this.getDeviceName(devicePath);
    const deviceInfo = deviceName ? `[${deviceName}]` : '[Unknown Device]';
    console.log(deviceInfo, message, ...optionalParams);
  }

  async onModuleInit() {
    this.log('Initializing BlueZ interface...', '');
    try {
      const bluez = await this.systemBus.getProxyObject('org.bluez', '/');
      this.bluez = bluez.getInterface('org.freedesktop.DBus.ObjectManager');
      this.log('BlueZ interface initialized successfully', '');

      // Спроба підключення до першого пристрою
      await this.connectToFirstDevice();
    } catch (error) {
      this.log('Failed to initialize BlueZ interface:', '', error);
    }
  }

  async connectToFirstDevice() {
    this.log('Listing devices...', '');
    try {
      const objects = await this.bluez.GetManagedObjects();
      const devices = Object.keys(objects).filter((path) =>
        path.includes('/org/bluez/hci0/dev_')
      );
      this.log('Discovered devices:', '', devices);

      if (devices.length === 0) {
        this.log('No devices found.', '');
        return;
      }

      const devicePath = devices[0];
      this.log('Attempting to connect to the first device:', devicePath);

      const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);
      const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');

      this.log('Connecting to device using retry logic...', devicePath);
      await this.connectWithRetry(deviceInterface, devicePath, 3, 2000);
      this.log('Device connected successfully.', devicePath);

      this.log('Reading characteristics...', devicePath);
      await this.readDeviceCharacteristics(deviceProxy, objects, devicePath);

      this.log('Reading battery level...', devicePath);
      await this.readAllCharacteristics(deviceProxy, objects, devicePath);
    } catch (error) {
      this.log('Failed to connect to device:', '', error);
    }
  }

  async connectWithRetry(deviceInterface, devicePath: string, retries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.log(`Attempt ${attempt} to connect to the device...`, devicePath);
        await deviceInterface.Connect();
        this.log('Device connected successfully.', devicePath);
        return;
      } catch (error) {
        this.log(`Connection attempt ${attempt} failed:`, devicePath, error);
        if (attempt < retries) {
          this.log(`Retrying in ${delay / 1000} seconds...`, devicePath);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.log('All connection attempts failed.', devicePath);
          throw error;
        }
      }
    }
  }

  async readDeviceCharacteristics(deviceProxy, objects, devicePath: string) {
    this.log('Reading device characteristics...', devicePath);
    try {
      const deviceProperties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
      const servicesResolved = await deviceProperties.Get('org.bluez.Device1', 'ServicesResolved');

      if (!servicesResolved.value) {
        this.log('Services are not resolved yet.', devicePath);
        return;
      }

      const services = Object.keys(objects).filter((path) =>
        path.startsWith(deviceProxy.path) && path.includes('service')
      );
      this.log('Discovered GATT services:', devicePath, services);

      for (const servicePath of services) {
        if (!objects[servicePath]['org.bluez.GattService1']) continue;

        this.log(`Inspecting service: ${servicePath}`, devicePath);
        const serviceProxy = await this.systemBus.getProxyObject('org.bluez', servicePath);
        const serviceProperties = serviceProxy.getInterface('org.freedesktop.DBus.Properties');
        const uuid = await serviceProperties.Get('org.bluez.GattService1', 'UUID');
        this.log(`Service ${servicePath} UUID: ${uuid.value}`, devicePath);

        const characteristics = Object.keys(objects).filter((path) =>
          path.startsWith(servicePath) && path.includes('char')
        );
        this.log(`Discovered characteristics for service ${servicePath}:`, devicePath, characteristics);

        for (const charPath of characteristics) {
          if (!objects[charPath]['org.bluez.GattCharacteristic1']) continue;

          this.log(`Inspecting characteristic: ${charPath}`, devicePath);
          try {
            const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
            const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');

            const charProperties = charProxy.getInterface('org.freedesktop.DBus.Properties');
            const flags = await charProperties.Get('org.bluez.GattCharacteristic1', 'Flags');

            if (flags.value.includes('read')) {
              const value = await charInterface.ReadValue({});
              this.log(`Value of characteristic ${charPath}:`, devicePath, value);
            }

            if (flags.value.includes('notify')) {
              await charInterface.StartNotify();
              this.log(`Subscribed to notifications for characteristic ${charPath}`, devicePath);
            }
          } catch (error) {
            this.log(`Error processing characteristic ${charPath}:`, devicePath, error);
          }
        }
      }
    } catch (error) {
      this.log('Failed to read device characteristics:', devicePath, error);
    }
  }

  async getDeviceName(devicePath: string): Promise<string | null> {
    try {
      const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);
      const deviceProperties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
      const name = await deviceProperties.Get('org.bluez.Device1', 'Name');
      return name.value;
    } catch (error) {
      console.error(`Failed to get device name for ${devicePath}:`, error);
      return null;
    }
  }
}
