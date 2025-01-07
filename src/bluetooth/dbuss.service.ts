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

      // Attempt to list devices and connect to one
      const devices = await this.listDevices();
      console.log('Discovered devices:', devices);

      if (devices.length > 0) {
        const firstDevice = devices[0];
        console.log(`Attempting to connect to the first device: ${firstDevice}`);

        const deviceProxy = await this.systemBus.getProxyObject('org.bluez', firstDevice);
        const deviceProperties = deviceProxy.getInterface('org.freedesktop.DBus.Properties');

        await this.connectToDevice(deviceProperties);
        await this.readDeviceCharacteristics(deviceProxy);
      } else {
        console.warn('No devices found to connect to.');
      }
    } catch (error) {
      console.error('Failed to initialize or connect:', error);
    }
  }

  async listDevices(): Promise<string[]> {
    console.log('Listing devices...');
    try {
      const objects = await this.bluez.GetManagedObjects();
      const devices = Object.keys(objects).filter((path) =>
        path.includes('/org/bluez/hci0/dev_')
      );
      return devices;
    } catch (error) {
      console.error('Failed to list devices:', error);
      return [];
    }
  }

  async connectToDevice(deviceProperties): Promise<void> {
    try {
      console.log('Powering on device...');
      await deviceProperties.Set('org.bluez.Device1', 'Powered', { type: 'boolean', value: true });

      console.log('Connecting to device...');
      await deviceProperties.Set('org.bluez.Device1', 'Connected', { type: 'boolean', value: true });
      console.log('Device connected successfully.');
    } catch (error) {
      console.error('Failed to connect to device:', error);
    }
  }

  async readDeviceCharacteristics(deviceProxy): Promise<void> {
    try {
      console.log('Reading device characteristics...');
      const characteristics = Object.keys(await deviceProxy.GetManagedObjects())
        .filter((path) => path.includes('/char'));

      for (const charPath of characteristics) {
        console.log(`Found characteristic: ${charPath}`);
        const charProxy = await this.systemBus.getProxyObject('org.bluez', charPath);
        const charProperties = charProxy.getInterface('org.freedesktop.DBus.Properties');
        const value = await charProperties.Get('org.bluez.GattCharacteristic1', 'Value');
        console.log(`Characteristic ${charPath} value:`, value);
      }
    } catch (error) {
      console.error('Failed to read device characteristics:', error);
    }
  }
}
