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
        await this.connectToDeviceWithRetries(devicePath, 5, 10000);

        const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);
        const properties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
        const deviceName = await properties.Get('org.bluez.Device1', 'Name');
        const devName = typeof deviceName === 'string' ? deviceName : JSON.stringify(deviceName);

        const isConnected = await properties.Get('org.bluez.Device1', 'Connected');
        const servicesResolved = await properties.Get('org.bluez.Device1', 'ServicesResolved');

        if (!isConnected || !servicesResolved) {
          console.warn(`Device ${devicePath} is not fully connected or services are not resolved.`);
          continue;
        }

        // Вивести всі характеристики для пристрою
        console.log(`[${devName}] Characteristics for device: ${devicePath}`);
        Object.keys(objects)
          .filter((path) => path.startsWith(devicePath))
          .forEach((path) => {
            const characteristic = objects[path]['org.bluez.GattCharacteristic1'];
            if (characteristic) {
              const uuid = characteristic.UUID;
              console.log(`[${devName}] Path: ${path}`);
              console.log(`[${devName}] UUID: ${typeof uuid === 'string' ? uuid : JSON.stringify(uuid)}`);
            }
          });

        // Зачекайте кілька секунд
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Пошук характеристики FFE1
        const charPath = Object.keys(objects).find((path) => {
          const characteristic = objects[path]['org.bluez.GattCharacteristic1'];
          const uuid = characteristic?.UUID?.value; // Додано витяг значення з об'єкта
          return uuid && uuid.toLowerCase() === '0000ffe1-0000-1000-8000-00805f9b34fb';
        });

        if (!charPath) {
          console.warn(`[${devName}] Characteristic FFE1 not found for device: ${devicePath}`);
          continue;
        }

        console.log(`Found characteristic FFE1: ${charPath}`);
        await this.sendCommandToBms(charPath, 0x97);
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

      // Перетворення Buffer у масив чисел (DBus очікує масив Variant)
      const commandArray = Array.from(command);

      await charInterface.WriteValue(commandArray, {}); // Передаємо масив чисел
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

  async connectToDeviceWithRetries(devicePath: string, retries = 10, delay = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Attempt ${attempt}] Connecting to device: ${devicePath}`);
        const devName = await this.connectToDevice(devicePath);
        console.log(`[${devName}] Successfully connected to device: ${devicePath}`);
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
    try {
      const deviceProxy = await this.systemBus.getProxyObject('org.bluez', devicePath);

      if (!deviceProxy.getInterface('org.bluez.Device1')) {
        throw new Error(`Device at path ${devicePath} does not implement org.bluez.Device1 interface`);
      }

      const deviceInterface = deviceProxy.getInterface('org.bluez.Device1');
      await deviceInterface.Connect();

      // Отримання імені пристрою
      const properties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');
      const deviceName = await properties.Get('org.bluez.Device1', 'Name');

      console.log(`Connected to device: ${devicePath} (Name: ${deviceName.value})`);
      return deviceName.value;
    } catch (error) {
      console.error(`Failed to connect to device ${devicePath}:`, error);
      throw error; // Перепідкидаємо помилку для подальшої обробки
    }
  }
}
