import { Injectable } from '@nestjs/common';
import dbus from 'dbus-next';

@Injectable()
export class BluetoothService {
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

  async init() {
    try {
      const bluez = await this.systemBus.getProxyObject(
        'org.bluez',
        '/'
      );
      this.bluez = bluez.getInterface('org.freedesktop.DBus.ObjectManager');
    } catch (error) {
      console.error('Failed to initialize BlueZ interface:', error);
    }
  }

  async listDevices() {
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
}
