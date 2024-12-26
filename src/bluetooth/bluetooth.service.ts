import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';
import { config } from 'configs/main.config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  getColorForRSSI,
  parseData,
} from 'src/utils/bluetooth.utils';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 50;

// const SERVICE_UUID = 'ffe0'; // 16-бітні
// const CHARACTERISTIC_UUID = 'ffe1';
const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb'; // 128-бітний формат
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);
  private connectedDevices: Map<string, noble.Peripheral> = new Map();
  private readonly rsColor = '\x1b[0m';
  private activeScan = false;

  constructor(private eventEmitter: EventEmitter2) { }

  async onModuleInit() {
    try {
      this.logger.log('Initializing Bluetooth...');

      noble.on('discover', this.onDiscover);
      noble.on('warning', (message) => {
        this.logger.warn(`Warning: ${message}`);
      });
      noble.on('uncaughtException', (error) => {
        this.logger.error(`\x1b[31mUncaught exception: ${error}`);
      });
      noble.on('error', (error) => {
        this.logger.error(`\x1b[31mPeripheral error: ${error.message}`);
      });
      noble.on('scanStart', () => {
        if (!this.activeScan) {
          this.activeScan = true;
          this.logger.log('\x1b[34mScanning has started...');
        }
      });
      noble.on('scanStop', async () => {
        if (this.activeScan) {
          this.activeScan = false;
          this.logger.log('\x1b[31mScanning stopped.');
        }

        if (!this.allDevicesConnected()) {
          await this.startScanning();
          this.connectedDevicesInfo();
        }
      });

      this.logger.log('\x1b[34mBluetooth initialization complete.');
      await this.setupBluetooth();
    } catch (error) {
      this.logger.error(`\x1b[31monModuleInit: ${error}`);
    }
  }

  private onDiscover = async (peripheral: noble.Peripheral) => {
    try {
      const manufacturerData =
        peripheral.advertisement.manufacturerData?.toString('hex');
      const localName = peripheral.advertisement.localName;
      const rssiColor = getColorForRSSI(peripheral.rssi);
      const deviceId = localName || peripheral.address || manufacturerData;

      if (!deviceId) {
        this.logger.warn('Discovered a device without identifier. Skipping.');
        return;
      }

      if (this.connectedDevices.has(deviceId)) {
        this.logger.warn(`Device ${deviceId} is already in process or connected.`);
        return;
      }

      if (
        config.allowedDevices.some(
          (device) => device.localName === deviceId || device.address === deviceId
        )
      ) {
        this.logger.log(`Discovered peripheral: \x1b[31m${deviceId}\x1b[32m, RSSI: ${rssiColor}${peripheral.rssi}`);

        if (
          this.connectedDevices.has(deviceId) &&
          peripheral.state === 'connected'
        ) {
          this.logger.warn(`Device \x1b[31m${deviceId}\x1b[31m is already connected.`);
          return;
        }

        await this.connectToDevice(peripheral);

        // Слухач на відключення та підключення
        peripheral.once('disconnect', async () => await this.onDisconnect(deviceId, peripheral));
        peripheral.on('connect', async () => await this.onConnect(deviceId, peripheral));

        // Далі можна отримати сервіси та характеристики
        this.logger.log('Починаємо отримувати сервіси...');
        await this.discoverServicesAndCharacteristics(peripheral, deviceId);
      }
    } catch (error) {
      this.logger.error(`\x1b[31mError discover: ${error}`);
      await peripheral.disconnectAsync();
    }
  };

  private async setupBluetooth() {
    noble.on('stateChange', async (state) => {
      this.logger.log(`The Bluetooth status has changed to: \x1b[31m${state}\x1b[32m.`);

      if (state === 'poweredOn') {
        this.logger.log('Bluetooth is turned on, start scanning...');
        try {
          await this.startScanning();
        } catch (error) {
          this.logger.error(`\x1b[31m[setupBluetooth] Scan startup error: ${error.message}`);
        }
      } else {
        this.logger.warn(`Bluetooth is not ready: ${state}`);
      }
    });
  }

  private async connectToDevice(peripheral: noble.Peripheral) {
    const deviceId = peripheral.advertisement.localName || peripheral.address || peripheral.advertisement.manufacturerData?.toString('hex');
    peripheral?.removeAllListeners();

    if (this.connectedDevices.has(deviceId)) {
      this.logger.warn(`Device ${deviceId} is already in process.`);
      return;
    }

    this.logger.log(`Connection to \x1b[31m${deviceId}\x1b[32m...`);
    try {
      await peripheral.connectAsync();
    } catch (error) {
      this.logger.error(`\x1b[31m[${deviceId}]\x1b[32m Error connecting to device ${deviceId}: ${error}`);
      if (peripheral.state === 'connected') {
        await peripheral.disconnectAsync();
      }
    }
  }

  private allDevicesConnected(): boolean {
    const allowedDevices = config.allowedDevices;
    return allowedDevices.every((deviceId) =>
      this.connectedDevices.has(deviceId.localName) || this.connectedDevices.has(deviceId.address)
    );
  }

  private connectedDevicesInfo(): void {
    const devices = Array.from(this.connectedDevices.values()).map((device) => {
      const macAddress = device.address.toUpperCase();
      const localName = device.advertisement.localName || 'Unknown';
      return { localName, address: macAddress };
    });

    if (devices.length) {
      // this.eventEmitter.emit('devices.connected', { devices });
      this.logger.log(`Connected devices: ${JSON.stringify(devices, null, 2)}`);
    }
  }

  private async startScanning() {
    try {
      // Battery Service '180f'
      await noble.startScanningAsync([], true);
    } catch (error) {
      this.logger.error(`Scan startup error: ${error.message}`);
    }
  }

  private async stopScanning() {
    if (this.activeScan) {
      try {
        await noble.stopScanningAsync();
      } catch (error) {
        this.logger.error(`Error stopping scan: ${error.message}`);
      }
    }
  }

  private async onDisconnect(deviceId: string, peripheral: noble.Peripheral) {
    this.logger.warn(`${deviceId} disconnected! Restarting scan...`);

    this.connectedDevices.delete(deviceId);
    this.connectedDevicesInfo();
    try {
      let attempts = 0;
      const maxAttempts = 2;

      const reconnect = async () => {
        if (attempts >= maxAttempts) {
          this.logger.error(`Failed to reconnect to ${deviceId} after ${maxAttempts} attempts.`);
          return;
        }
        attempts++;
        try {
          await this.connectToDevice(peripheral);
          this.logger.log(`\x1b[34mDevice \x1b[31m${deviceId} \x1b[34mreconnected after ${attempts} attempt(s).`);
        } catch (error) {
          this.logger.error(`Reconnect attempt ${attempts} failed for ${deviceId}: ${error.message}`);
          setTimeout(reconnect, 2000);
        }
      };

      reconnect();
    } catch (error) {
      this.logger.error(`[disconnect] Failed to start scanning: ${error.message}`);
    }
  }

  private async onConnect(deviceId: string, peripheral: noble.Peripheral) {
    if (this.connectedDevices.has(deviceId)) {
      return;
    }

    this.connectedDevices.set(deviceId, peripheral);
    this.connectedDevicesInfo();
    this.logger.log(`\x1b[34mDevice \x1b[31m${deviceId}\x1b[34m connected successfully.`);

    try {
      await this.startScanning();
    } catch (error) {
      this.logger.error(`[connect] Failed to start scanning: ${error.message}`);
    }

    if (this.allDevicesConnected() && this.activeScan) {
      this.logger.log('All devices connected. Stopping scan...');
      await this.stopScanning();
    }
  }

  private async discoverServicesAndCharacteristics(device: noble.Peripheral, deviceId: string) {
    try {
      if (device.state !== 'connected') {
        this.logger.warn(`[${deviceId}] Peripheral is not connected. Skipping service discovery.`);
        return;
      }

      const services = await device.discoverServicesAsync([]);
      this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Discovered services: ${services.length}`);

      for (const service of services) {
        this.logger.log('\x1b[31mservice', service);

        const characteristics = await service.discoverCharacteristicsAsync([]);
        for (const characteristic of characteristics) {
          this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Service: ${service.uuid}, Features: ${characteristics.length}`);

          // Якщо характеристика підтримує читання
          if (characteristic.properties.includes('read')) {
            const data = await characteristic.readAsync();
            const utf8String = data.toString('utf8'); // Якщо дані є текстом
            const hexString = data.toString('hex'); // Якщо потрібен формат HEX

            this.logger.log(
              `\x1b[31m[${deviceId}]\x1b[32m Data from characteristic ${characteristic.uuid}: UTF-8: ${utf8String}, HEX: ${hexString}`,
            );
          }

          if (characteristic.properties.includes('notify')) {
            console.log(`Subscribing to notifications for characteristic ${characteristic.uuid}`);
            await characteristic.subscribeAsync();
            characteristic.on('data', (data) => {
              parseData(data);
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error in service/characteristic discovery: ${error.message}`);
    }
  }
}

