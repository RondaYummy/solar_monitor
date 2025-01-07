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
    } catch (error) {
      console.error('Failed to initialize BlueZ interface:', error);
    }
  }

  async testConnection() {
    try {
      console.log('Testing BlueZ connection...');
      const adapter = await this.systemBus.getProxyObject('org.bluez', '/org/bluez/hci0');
      const properties = adapter.getInterface('org.freedesktop.DBus.Properties');

      const address = await properties.Get('org.bluez.Adapter1', 'Address');
      console.log('Adapter Address:', address);

      const powered = await properties.Get('org.bluez.Adapter1', 'Powered');
      console.log('Adapter Powered:', powered);
    } catch (error) {
      console.error('Error testing connection:', error);
    }
  }


  async init() {
    console.log('Initializing BlueZ interface...');
    try {
      const bluez = await this.systemBus.getProxyObject('org.bluez', '/');
      this.bluez = bluez.getInterface('org.freedesktop.DBus.ObjectManager');
      console.log('BlueZ interface initialized successfully');
    } catch (error) {
      console.error('Failed to initialize BlueZ interface:', error);
    }
  }

  async listDevices() {
    console.log('Listing devices...');
    try {
      const objects = await this.bluez.GetManagedObjects();
      const devices = Object.keys(objects).filter((path) =>
        path.includes('/org/bluez/hci0/dev_')
      );
      console.log('Found devices:', devices);
      return devices;
    } catch (error) {
      console.error('Failed to list devices:', error);
      return [];
    }
  }

}
