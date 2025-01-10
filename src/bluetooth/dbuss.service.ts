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
    const objects = await this.bluez.GetManagedObjects();
    const devicePaths = Object.keys(objects).filter((path) =>
      path.includes('/org/bluez/hci0/dev_') &&
      !path.includes('service') &&
      !path.includes('char') &&
      !path.includes('desc')
    );

    for (const devicePath of devicePaths) {
      try {
        await this.connectToDeviceWithRetries(devicePath, 5, 3000);

        const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);
        const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');
        const properties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
        const isConnected = await properties.Get('org.bluez.Device1', 'Connected');
        if (!isConnected) {
          console.warn(`Device ${devicePath} is not connected.`);
          continue;
        }

        // Знайти характеристику FFE1
        const charPath = Object.keys(objects).find((path) =>
          path.startsWith(devicePath) &&
          objects[path]['org.bluez.GattCharacteristic1']?.UUID.toLowerCase() === '0000ffe1-0000-1000-8000-00805f9b34fb'
        );
        console.log(charPath);

        if (!charPath) {
          console.warn(`Characteristic FFE1 not found for device: ${devicePath}`);
          continue;
        }

        console.log(`Found characteristic FFE1: ${charPath}`);

        // Надіслати команду Device Info (0x97)
        await this.sendCommandToBms(charPath, 0x97);

        // Налаштувати нотифікації
        await this.setupNotification(charPath);
      } catch (error) {
        console.error(`Failed to connect to device ${devicePath}. Skipping...`, error);
      }
    }
  }

  async sendCommandToBms(charPath: string, commandType: number) {
    const command = Buffer.from([
      0xAA, 0x55, 0x90, 0xEB, // Header
      commandType,            // Command (0x97 - Device Info)
      0x00,                   // Length
      0x00, 0x00, 0x00, 0x00, // Value
      0x00, 0x00, 0x00, 0x00, // Padding
      0x00, 0x00, 0x00, 0x00,
      0x00                    // CRC
    ]);

    // Обчислення CRC
    command[command.length - 1] = command.slice(0, -1).reduce((crc, byte) => crc + byte, 0) & 0xFF;

    try {
      const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
      const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');
      await charInterface.WriteValue(command, {});
      console.log(`Command 0x${commandType.toString(16)} sent: ${command.toString('hex').toUpperCase()}`);
    } catch (error) {
      console.error(`Failed to send command 0x${commandType.toString(16)} to BMS:`, error);
    }
  }

  async setupNotification(charPath: string) {
    try {
      const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
      const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');

      await charInterface.StartNotify();
      console.log('Notifications started.');

      charInterface.on('PropertiesChanged', (iface, changed) => {
        if (changed.Value) {
          const data = Buffer.from(changed.Value.value);
          console.log('Notification received:', data.toString('hex').toUpperCase());
          this.processBmsNotification(data);
        }
      });
    } catch (error) {
      console.error('Failed to setup notification:', error);
    }
  }

  processBmsNotification(data: Buffer) {
    const startSequence = [0x55, 0xAA, 0xEB, 0x90];
    if (data.slice(0, 4).equals(Buffer.from(startSequence))) {
      console.log('Valid frame start detected.');
      // Додайте обробку даних тут
    } else {
      console.warn('Invalid frame start.');
    }
  }

  async connectToDeviceWithRetries(devicePath: string, retries = 99, delay = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Attempt ${attempt}] Connecting to device: ${devicePath}`);
        await this.connectToDevice(devicePath);
        console.log(`Successfully connected to device: ${devicePath}`);
        return;
      } catch (error) {
        console.error(`[Attempt ${attempt}] Failed to connect to device ${devicePath}:`, error);
        if (attempt < retries) {
          console.log(`Retrying in ${delay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          console.error(`All attempts to connect to device ${devicePath} failed.`);
        }
      }
    }
  }

  async connectToDevice(devicePath: string) {
    const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);

    if (!deviceProxy.getInterface('org.bluez.Device1')) {
      throw new Error(`Device at path ${devicePath} does not implement org.bluez.Device1 interface`);
    }

    const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');
    await deviceInterface.Connect();
    console.log(`Connected to device: ${devicePath}`);
  }
}
