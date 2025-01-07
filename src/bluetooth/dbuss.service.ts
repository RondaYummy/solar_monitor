import { Injectable } from '@nestjs/common';
import dbus from 'dbus-next';

@Injectable()
export class BluetoothService {
  private systemBus;
  private bluez;

  constructor() {
    this.systemBus = dbus.systemBus();
  }

  async init() {
    const bluez = await this.systemBus.getProxyObject(
      'org.bluez',
      '/'
    );
    this.bluez = bluez.getInterface('org.freedesktop.DBus.ObjectManager');
  }

  async listDevices() {
    const objects = await this.bluez.GetManagedObjects();
    const devices = Object.keys(objects).filter((path) =>
      path.includes('/org/bluez/hci0/dev_')
    );
    return devices;
  }
}
