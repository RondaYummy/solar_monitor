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

      // Спробуємо підключитись до пристрою
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
      const properties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');

      console.log('Powering on device...');
      await properties.Set('org.bluez.Device1', 'Powered', new dbus.Variant('b', true));

      console.log('Connecting to device...');
      await properties.Set('org.bluez.Device1', 'Connected', new dbus.Variant('b', true));

      console.log('Device connected. Reading characteristics...');
      await this.readDeviceCharacteristics(deviceProxy);
    } catch (error) {
      console.error('Failed to connect to device:', error);
    }
  }

  async readDeviceCharacteristics(deviceProxy) {
    console.log('Reading device characteristics...');
    try {
      const gattServiceInterface = deviceProxy.getInterface('org.bluez.GattService1');
      const characteristics = await gattServiceInterface.GetManagedObjects();

      for (const [path, properties] of Object.entries(characteristics)) {
        console.log(`Path: ${path}`);
        console.log(`Properties: ${JSON.stringify(properties)}`);
      }
    } catch (error) {
      console.error('Failed to read device characteristics:', error);
    }
  }
}
