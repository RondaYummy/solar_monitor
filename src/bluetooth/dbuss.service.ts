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
      await this.readDeviceCharacteristics(deviceProxy);
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

  async readDeviceCharacteristics(deviceProxy) {
    console.log('Reading device characteristics...');
    try {
      // Отримання всіх об'єктів пристрою
      const objects = await this.bluez.GetManagedObjects();
      console.log('Fetched ManagedObjects:', objects);

      // Пошук GATT-сервісів у межах цього пристрою
      const services = Object.keys(objects).filter((path) =>
        path.startsWith(deviceProxy.path) && path.includes('service')
      );
      console.log('Discovered GATT services:', services);

      if (services.length === 0) {
        console.warn('No GATT services found for this device.');
        return;
      }

      // Ітерація по сервісах і виведення їхніх UUID
      for (const servicePath of services) {
        const serviceProxy = await this.systemBus.getProxyObject('org.bluez', servicePath);
        const characteristics = Object.keys(objects).filter((path) =>
          path.startsWith(servicePath) && path.includes('char')
        );

        for (const charPath of characteristics) {
          try {
            const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
            const charInterface = charProxy.getInterface('org.bluez.GattCharacteristic1');

            if (charInterface) {
              console.log(`Characteristic found: ${charPath}`);
              const uuid = await charProxy.getInterface('org.freedesktop.DBus.Properties').Get('org.bluez.GattCharacteristic1', 'UUID');
              console.log(`UUID: ${uuid.value}`);
            } else {
              console.warn(`No GattCharacteristic1 interface for ${charPath}`);
            }
          } catch (err) {
            console.error(`Error processing characteristic ${charPath}:`, err);
          }
        }
      }
    } catch (error) {
      console.error('Failed to read device characteristics:', error);
    }
  }

}
