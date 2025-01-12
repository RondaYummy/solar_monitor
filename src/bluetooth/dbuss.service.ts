import { Injectable, OnModuleInit } from '@nestjs/common';
import * as dbus from 'dbus-next';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private systemBus;
  private bluez;
  private responseBuffer = Buffer.alloc(0);

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

  async scanForDevices() {
    const adapterProxy = await this.systemBus.getProxyObject('org.bluez', '/org/bluez/hci0');
    const adapterInterface = adapterProxy.getInterface('org.bluez.Adapter1');
    await adapterInterface.StartDiscovery();
    console.log('Scanning for devices...');
  }

  async connectToAllDevices() {
    await this.scanForDevices();
    await new Promise((resolve) => setTimeout(resolve, 10000)); // Зачекати 10 секунд на сканування

    const objects = await this.bluez.GetManagedObjects();
    console.log(Object.keys(objects), 'All paths');

    const devicePaths = Object.keys(objects).filter((path) =>
      path.includes('/org/bluez/hci0/dev_') &&
      !path.includes('service') &&
      !path.includes('char') &&
      !path.includes('desc')
    );
    console.log(devicePaths, 'devicePaths');

    for (const devicePath of devicePaths) {
      try {
        const connected = await this.connectToDeviceWithRetries(devicePath, 2, 5000);
        if (!connected) {
          console.warn(`Skipping device ${devicePath} as it could not connect after multiple attempts.`);
          continue;
        }

        const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);
        const properties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
        const deviceName = await properties.Get('org.bluez.Device1', 'Name');
        const devName = typeof deviceName === 'string' ? deviceName : deviceName?.value;

        const isConnected = await properties.Get('org.bluez.Device1', 'Connected');
        const servicesResolved = await properties.Get('org.bluez.Device1', 'ServicesResolved');

        if (!isConnected || !servicesResolved) {
          console.warn(`[${devName}] Device ${devicePath} is not fully connected or services are not resolved.`);
          continue;
        }

        console.log(`[${devName}] Characteristics for device: ${devicePath}`);
        Object.keys(objects)
          .filter((path) => path.startsWith(devicePath))
          .forEach((path) => {
            const characteristic = objects[path]['org.bluez.GattCharacteristic1'];
            if (characteristic) {
              const uuid = characteristic.UUID;
              const flags = characteristic.Flags;

              console.group(`[${devName}] Details`);
              console.log(`Path: ${path}`);
              console.log(`UUID: ${typeof uuid === 'string' ? uuid : JSON.stringify(uuid)}`);
              console.log(`Flags: ${flags ? JSON.stringify(flags) : 'No flags available'}`);
              console.groupEnd();
            }
          });

        await new Promise((resolve) => setTimeout(resolve, 5000)); // Зачекати 5 секунд
        const charPath = Object.keys(objects).find((path) => {
          const characteristic = objects[path]['org.bluez.GattCharacteristic1'];
          if (!characteristic) return false;

          const uuid = characteristic?.UUID?.value || characteristic?.UUID;
          console.log(`UUID: ${uuid}`);
          if (!uuid) {
            console.warn(`[${devName}] Characteristic UUID is undefined for path: ${path}`);
            return;
          }
          return uuid && uuid.toLowerCase() === '0000ffe1-0000-1000-8000-00805f9b34fb';
        });

        if (!charPath) {
          console.warn(`[${devName}] Characteristic FFE1 not found for device: ${devicePath}`);
          continue;
        }

        console.log(`Found characteristic FFE1: ${charPath}`);

        const descriptorPaths = Object.keys(objects).filter(
          (path) => path.startsWith(charPath) && path.includes('desc')
        );

        const descriptor2902 = descriptorPaths.find((path) => {
          return objects[path]['org.bluez.GattDescriptor1'].UUID?.value &&
            objects[path]['org.bluez.GattDescriptor1'].UUID?.value === '00002902-0000-1000-8000-00805f9b34fb';
        }
        );

        if (descriptor2902) {
          console.log(`[${devName}] Found descriptor 0x2902 for characteristic ${charPath}: ${descriptor2902}`);
          await this.enableNotificationsForDescriptor(descriptor2902);
        } else {
          console.warn(`[${devName}] Descriptor 0x2902 not found for characteristic ${charPath}`);
        }

        await this.sendCommandToBms(charPath, 0x97, devName);

        await this.setupNotification(charPath, devName, objects);
      } catch (error) {
        console.error(`Failed to connect to device ${devicePath}. Skipping...`, error);
      }
    }
  }

  calculateCrc(data: Buffer): number {
    return data.slice(0, -1).reduce((crc, byte) => crc + byte, 0) & 0xFF;
  }

  async sendCommandToBms(charPath: string, commandType: number, devName: string) {
    const command = Buffer.from([
      0xAA, 0x55, 0x90, 0xEB, // Header
      commandType, // Command (0x97 - Device Info)
      0x00, // Length
      0x00, 0x00, 0x00, 0x00, // Value
      0x00, 0x00, 0x00, 0x00, // Padding
      0x00, 0x00, 0x00, 0x00,
      0x00, // CRC
    ]);

    command[command.length - 1] = this.calculateCrc(command);

    console.log(`Command: ${command.toString('hex').toUpperCase()}, CRC: ${command[command.length - 1]}`);

    try {
      const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
      const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');
      const commandArray = Array.from(command);

      await charInterface.WriteValue(commandArray, {});
      console.log(`[${devName}] Command 0x${commandType.toString(16)} sent to handle 0x03: ${command.toString('hex').toUpperCase()}`);
      console.log(`[${devName}] Command 0x${commandType.toString(16)} sent: ${command.toString('hex').toUpperCase()}`);
    } catch (error) {
      console.error(`[${devName}] Failed to send command 0x${commandType.toString(16)} to BMS:`, error);
    }
  }

  async enableNotificationsForDescriptor(descriptorPath: string) {
    try {
      const descriptorProxy = await this.systemBus.getProxyObject('org.bluez', descriptorPath);
      const descriptorInterface = descriptorProxy.getInterface('org.bluez.GattDescriptor1');

      const properties = descriptorProxy.getInterface('org.freedesktop.DBus.Properties');
      const flags = await properties.Get('org.bluez.GattDescriptor1', 'Flags');

      if (!flags.includes('write')) {
        console.warn(`Descriptor ${descriptorPath} does not support write operations.`);
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      await descriptorInterface.WriteValue([0x01, 0x00], {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(`Notifications enabled via descriptor for: ${descriptorPath}`);
    } catch (error) {
      console.error(`Failed to enable notifications via descriptor: ${descriptorPath}`, error);
    }
  }

  async setupNotification(charPath: string, devName: string, objects: Record<string, any>) {
    try {
      const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
      const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');

      const characteristicFlags = objects[charPath]['org.bluez.GattCharacteristic1'].Flags;
      if (!characteristicFlags.includes('notify')) {
        console.warn(`[${devName}] Characteristic ${charPath} does not support notifications.`);
        return;
      }

      await charInterface.StartNotify();
      console.log(`[${devName}] Notifications enabled for characteristic: ${charPath}`);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      charInterface.on('PropertiesChanged', (iface, changed) => {
        console.log(`[${devName}] PropertiesChanged event:`, iface, changed);
        if (changed.Value) {
          const data = Buffer.from(changed.Value);
          console.log(`[${devName}] Notification received: ${data.toString('hex').toUpperCase()}`);
          this.processBmsNotification(data, devName);
        }
      });
    } catch (error) {
      console.error(`[${devName}] Failed to setup notification:`, error);
    }
  }

  validateCrc(data: Buffer): boolean {
    if (data.length < 20) {
      return false;
    }

    const calculatedCrc = data.slice(0, -1).reduce((crc, byte) => crc + byte, 0) & 0xFF;
    const receivedCrc = data[data.length - 1];

    return calculatedCrc === receivedCrc;
  }

  processBmsNotification(data: Buffer, devName: string) {
    const startSequence = Buffer.from([0x55, 0xAA, 0xEB, 0x90]);
    if (data.slice(0, 4).equals(startSequence)) {
      console.log(`[${devName}] Start sequence received, resetting buffer.`);
      this.responseBuffer = Buffer.alloc(0);
    }

    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);

    if (this.responseBuffer.length >= 320) {
      console.log(`[${devName}] Complete data frame received. Validating CRC...`);
      const isValidCrc = this.validateCrc(this.responseBuffer);
      if (!isValidCrc) {
        console.warn(`[${devName}] Invalid CRC. Discarding frame.`);
        this.responseBuffer = Buffer.alloc(0);
        return;
      }
      this.handleBmsResponse(this.responseBuffer, devName);
      this.responseBuffer = Buffer.alloc(0);
    }
  }

  handleBmsResponse(data: Buffer, devName: string) {
    const responseType = data[4];
    switch (responseType) {
      case 0x01:
        console.log(`[${devName}] Settings frame received`);
        break;
      case 0x02:
        console.log(`[${devName}] Cell info frame received`);
        break;
      case 0x03:
        console.log(`[${devName}] Device info frame received`);
        break;
      default:
        console.warn(`[${devName}] Unknown response type: ${responseType}`);
    }
  }

  async connectToDevice(devicePath: string) {
    try {
      console.log(`Attempting to connect to device: ${devicePath}`);
      const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);

      if (!deviceProxy || !deviceProxy.getInterface('org.bluez.Device1')) {
        throw new Error(`Device ${devicePath} does not have the required interface 'org.bluez.Device1'`);
      }

      const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');
      const properties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');

      // Перевірка наявного з'єднання перед підключенням
      const isConnected = await properties.Get('org.bluez.Device1', 'Connected');
      if (isConnected) {
        console.log(`[${devicePath}] Device is already connected.`);
        return;
      }

      console.log(`Calling Connect() on device: ${devicePath}`);
      await deviceInterface.Connect();

      // Додатковий час для стабілізації з'єднання
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const servicesResolved = await properties.Get('org.bluez.Device1', 'ServicesResolved');
      if (!servicesResolved) {
        throw new Error(`Device ${devicePath} connected, but services are not resolved.`);
      }

      console.log(`[${devicePath}] Successfully connected and services resolved.`);
    } catch (error) {
      console.error(`Error connecting to device ${devicePath}:`, error.message || error);
      throw error; // Пропустити помилку для ретраю
    }
  }

  async connectToDeviceWithRetries(devicePath: string, retries = 3, delay = 5000): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Attempt ${attempt}] Connecting to device: ${devicePath}`);
        await this.connectToDevice(devicePath);
        return true;
      } catch (error) {
        console.error(`[Attempt ${attempt}] Failed to connect:`, error.message || error);
        if (attempt < retries) {
          console.log(`Retrying in ${delay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    console.error(`All attempts to connect to device ${devicePath} failed.`);
    return false;
  }
}
