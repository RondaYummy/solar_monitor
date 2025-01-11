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
        const connected = await this.connectToDeviceWithRetries(devicePath, 5, 8000);
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
          const uuid = characteristic?.UUID?.value;
          const handle = characteristic?.Handle;
          return uuid && uuid.toLowerCase() === '0000ffe1-0000-1000-8000-00805f9b34fb' && handle === 0x03;
        });

        if (!charPath) {
          console.warn(`[${devName}] Characteristic FFE1 not found for device: ${devicePath}`);
          continue;
        }

        console.log(`Found characteristic FFE1: ${charPath}`);
        await this.sendCommandToBms(charPath, 0x97, devName);
        await this.setupNotification(charPath, devName);
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
      commandType,            // Command (0x97 - Device Info)
      0x00,                   // Length
      0x00, 0x00, 0x00, 0x00, // Value
      0x00, 0x00, 0x00, 0x00, // Padding
      0x00, 0x00, 0x00, 0x00,
      0x00                    // CRC
    ]);

    command[command.length - 1] = this.calculateCrc(command);

    try {
      const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
      const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');
      const commandArray = Array.from(command);

      await charInterface.WriteValue(commandArray, {});
      console.log(`[${devName}] Command 0x${commandType.toString(16)} sent: ${command.toString('hex').toUpperCase()}`);
    } catch (error) {
      console.error(`[${devName}] Failed to send command 0x${commandType.toString(16)} to BMS:`, error);
    }
  }

  async setupNotification(charPath: string, devName: string) {
    try {
      const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
      const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');

      await charInterface.StartNotify();
      console.log(`[${devName}] Notifications started.`);

      charInterface.on('PropertiesChanged', (iface, changed) => {
        console.log(`[${devName}] PropertiesChanged event received:`, iface, changed);

        if (Array.isArray(changed.Value)) {
          const data = Buffer.from(changed.Value);
          console.log(`[${devName}] Notification received:`, data.toString('hex').toUpperCase());
          this.processBmsNotification(data, devName);
        }
      });
    } catch (error) {
      console.error(`[${devName}] Failed to setup notification:`, error);
    }
  }

  validateCrc(data: Buffer): boolean {
    if (data.length < 20) {
      console.warn('Data is too short to contain a valid CRC.');
      return false;
    }

    const calculatedCrc = data.slice(0, -1).reduce((crc, byte) => crc + byte, 0) & 0xFF;
    const receivedCrc = data[data.length - 1];

    return calculatedCrc === receivedCrc;
  }

  processBmsNotification(data: Buffer, devName: string) {
    const startSequence = Buffer.from([0x55, 0xAA, 0xEB, 0x90]);
    if (data.slice(0, 4).equals(startSequence)) {
      console.log(`[${devName}] Valid frame start detected.`);
      this.responseBuffer = Buffer.alloc(0); // Очищення буфера
    }
    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);

    if (this.responseBuffer.length >= 320) { // Максимальний розмір фрейму
      const isValidCrc = this.validateCrc(this.responseBuffer);
      if (isValidCrc) {
        console.log(`[${devName}] Valid frame received:`, this.responseBuffer.toString('hex').toUpperCase());
        this.handleBmsResponse(this.responseBuffer, devName);
      } else {
        console.warn(`[${devName}] Invalid CRC. Frame discarded.`);
      }
      this.responseBuffer = Buffer.alloc(0); // Скидання буфера
    }
  }

  handleBmsResponse(data: Buffer, devName: string) {
    const responseType = data[4];
    switch (responseType) {
      case 0x01:
        console.log(`[${devName}] Settings frame received`);
        // Обробка налаштувань
        break;
      case 0x02:
        console.log(`[${devName}] Cell info frame received`);
        // Обробка інформації про елементи
        break;
      case 0x03:
        console.log(`[${devName}] Device info frame received`);
        // Обробка інформації про пристрій
        break;
      default:
        console.warn(`[${devName}] Unknown response type: ${responseType}`);
    }
  }

  async subscribeToNotifications(charPath: string, devName: string) {
    const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
    const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');
    await charInterface.StartNotify().catch((err) => {
      console.error(`[${devName}] Failed to start notifications:`, err);
    });
    console.log(`[${devName}] Subscribed to notifications.`);
  }

  async connectToDeviceWithRetries(devicePath: string, retries = 5, delay = 8000): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Attempt ${attempt}] Connecting to device: ${devicePath}`);
        await this.connectToDevice(devicePath);
        console.log(`Successfully connected to device: ${devicePath}`);
        return true;
      } catch (error) {
        console.error(`[Attempt ${attempt}] Failed to connect to device ${devicePath}:`, error);
        if (attempt < retries) {
          console.log(`Retrying in ${delay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    console.error(`All attempts to connect to device ${devicePath} failed.`);
    return false;
  }

  async connectToDevice(devicePath: string) {
    try {
      const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);

      if (!deviceProxy.getInterface('org.bluez.Device1')) {
        throw new Error(`Device at path ${devicePath} does not implement org.bluez.Device1 interface`);
      }

      const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');
      await deviceInterface.Connect();

      const properties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
      const deviceName = await properties.Get('org.bluez.Device1', 'Name');
      console.log(`[${deviceName.value}] Connected to device: ${devicePath} (Name: ${deviceName.value})`);
      return deviceName.value;
    } catch (error) {
      console.error(`Failed to connect to device ${devicePath}:`, error);
      throw error;
    }
  }
}
