import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as dbus from 'dbus-next';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);
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

      await this.connectToAllDevices();
    } catch (error) {
      console.error('Failed to initialize BlueZ interface:', error);
    }
  }

  async connectToAllDevices() {
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

      // Асинхронно підключаємось до всіх пристроїв із повторними спробами
      await Promise.all(
        devices.map(async (devicePath) => {
          console.log(`Attempting to connect to device: ${devicePath}`);
          await this.connectToDeviceWithRetries(devicePath, objects, 10, 2000); // 10 спроб, затримка 2 сек
        })
      );
    } catch (error) {
      console.error('Failed to connect to devices:', error);
    }
  }

  async connectToDeviceWithRetries(devicePath: string, objects: any, retries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Attempt ${attempt}] Connecting to device: ${devicePath}`);
        await this.connectToDevice(devicePath, objects);
        return;
      } catch (error) {
        console.error(`[Attempt ${attempt}] Failed to connect to device ${devicePath}:`, error);
        if (attempt < retries) {
          console.log(`Retrying in ${delay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.error(`[Attempt ${attempt}] All connection attempts failed for device: ${devicePath}`);
        }
      }
    }
  }

  async connectToDevice(devicePath: string, objects: any) {
    try {
      const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);
      const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');

      console.log(`Connecting to device using retry logic: ${devicePath}`);
      await deviceInterface.Connect();

      console.log(`Device connected successfully: ${devicePath}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log(`Reading characteristics for device: ${devicePath}`);
      await this.readDeviceCharacteristics(deviceProxy, objects);

      console.log(`Reading battery SOC for device: ${devicePath}`);
      await this.readBatterySOC(deviceProxy, devicePath);
    } catch (error) {
      throw new Error(`Failed to connect to device ${devicePath}: ${error.message}`);
    }
  }

  async readDeviceCharacteristics(deviceProxy, objects) {
    console.log('\x1b[32mReading device characteristics...');
    try {
      const services = Object.keys(objects).filter((path) =>
        path.startsWith(deviceProxy.path) && path.includes('service')
      );
      console.log('Discovered GATT services:', services);

      for (const servicePath of services) {
        if (!objects[servicePath]['org.bluez.GattService1']) continue;

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

          const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
          const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');
          const charProperties = charProxy.getInterface('org.freedesktop.DBus.Properties');
          const charUUID = await charProperties.Get('org.bluez.GattCharacteristic1', 'UUID');
          const flags = await charProperties.Get('org.bluez.GattCharacteristic1', 'Flags');

          console.log(`Inspecting characteristic: ${charPath}, UUID: ${charUUID.value}, Flags: ${flags.value}`);

          if (charUUID.value === 'f000ffc1-0451-4000-b000-000000000000') {
            const activationCommand = Buffer.from([0xDD, 0xA5, 0x03, 0x00, 0xFF, 0xFD, 0x77]);
            await charInterface.WriteValue(activationCommand, {});
            console.log(`Activation command sent to ${charPath}`);
          }

          if (flags.value.includes('notify')) {
            try {
              await charInterface.StartNotify();
              console.log(`Subscribed to notifications for characteristic ${charPath}`);
              charInterface.on('PropertiesChanged', (iface, changed, invalidated) => {
                console.log(`PropertiesChanged event: iface=${iface}, changed=${JSON.stringify(changed)}`);
                if (changed.Value) {
                  console.log(
                    `\x1b[31mNotification from ${charPath}:`,
                    this.bufferToHex(Buffer.from(changed.Value.value))
                  );
                }
              });
            } catch (notifyError) {
              console.error(`Error enabling notifications for ${charPath}:`, notifyError);
            }
          }

          if (flags.value.includes('read')) {
            try {
              const value = await charInterface.ReadValue({});
              console.log(
                `\x1b[31mCharacteristic ${charPath} value (UUID: ${charUUID.value}) | HEX: ${this.bufferToHex(value)}, Int: ${this.bufferToInt(value)}, UTF-8: ${this.bufferToUtf8(value)}`
              );
            } catch (readError) {
              console.error(`Error reading characteristic ${charPath}:`, readError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to read device characteristics:', error);
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

  private async log(message: string, devicePath: string, ...optionalParams: any[]) {
    const deviceName = await this.getDeviceName(devicePath);
    const deviceInfo = deviceName ? `[${deviceName}]` : '[Unknown Device]';
    this.logger.log(`${deviceInfo} ${message}`, ...optionalParams);
  }

  async readBatterySOC(deviceProxy: any, devicePath: string): Promise<void> {
    try {
      const objects = await this.bluez.GetManagedObjects();
      const characteristics = Object.keys(objects).filter((path) =>
        path.startsWith(devicePath) && path.includes('char')
      );

      for (const charPath of characteristics) {
        if (!objects[charPath]['org.bluez.GattCharacteristic1']) {
          console.warn(`Skipping characteristic ${charPath} as it lacks GattCharacteristic1 interface.`);
          continue;
        }

        const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
        const charProperties = charProxy.getInterface('org.freedesktop.DBus.Properties');
        const uuid = await charProperties.Get('org.bluez.GattCharacteristic1', 'UUID');

        if (uuid.value === '00002a19-0000-1000-8000-00805f9b34fb') {
          const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');
          this.log('Reading battery level...', devicePath);
          const value = await charInterface.ReadValue({});
          const soc = this.bufferToInt(Buffer.from(value));

          this.log(`Battery SOC: ${soc}%`, devicePath);
          return;
        }
      }

      this.logger.warn('Battery SOC characteristic not found.', devicePath);
    } catch (error) {
      this.logger.error('Failed to read battery SOC:', error);
    }
  }
}
