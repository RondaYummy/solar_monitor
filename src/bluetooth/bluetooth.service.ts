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
      // noble.removeAllListeners();

      noble.on('discover', async (peripheral) => {
        try {
          const manufacturerData =
            peripheral.advertisement.manufacturerData?.toString('hex');
          const localName = peripheral.advertisement.localName;
          const rssiColor = getColorForRSSI(peripheral.rssi);
          const deviceId = localName || peripheral.address || manufacturerData;
          this.logger.log(`Discovered peripheral: \x1b[31m${deviceId}\x1b[32m, RSSI: ${rssiColor}${peripheral.rssi}`);

          if (
            config.allowedDevices.some(
              (device) => device.localName === deviceId || device.address === deviceId
            )
          ) {
            if (
              this.connectedDevices.has(deviceId) &&
              peripheral.state === 'connected'
            ) {
              this.logger.warn(`Device \x1b[31m${deviceId}\x1b[31m is already connected.`);
              return;
            }

            await this.connectToDevice(peripheral);
            // await discoverServicesAndCharacteristics(peripheral); // TODO
          }
        } catch (error) {
          this.logger.error(`\x1b[31mError discover: ${error}`);
        }
      });

      noble.on('warning', (message) => {
        this.logger.warn(`Warning: ${message}`);
      });
      noble.on('uncaughtException', (error) => {
        this.logger.error(`\x1b[31mUncaught exception: ${error}`);
      });
      noble.on('error', (error) => {
        this.logger.error(`\x1b[31mPeripheral error: ${error.message}`);
      });

      this.logger.log('Bluetooth initialization complete.');
      await this.setupBluetooth();
    } catch (error) {
      this.logger.error(`\x1b[31monModuleInit: ${error}`);
    }
  }

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

    if (this.connectedDevices.has(deviceId)) {
      this.logger.warn(`Device ${deviceId} is already in process.`);
      return;
    }

    this.logger.log(`Connection to \x1b[31m${deviceId}\x1b[32m...`);

    try {
      // peripheral.removeAllListeners(); // TODO
      await peripheral.connectAsync();
      this.logger.log(`[connectToDevice] Connected to \x1b[31m${deviceId}`);
      // await this.stopScanning(); // TODO
      // this.logger.log(`[connectToDevice] Stopped scanning for ${deviceId}`);

      // Слухач на відключення та запуск скану нових повторно
      peripheral.once('disconnect', async () => {
        this.logger.warn(`${deviceId} disconnected! Restarting scan...`);

        // peripheral.removeAllListeners(); // TODO

        this.connectedDevices.delete(deviceId);
        this.connectedDevicesInfo();

        try {
          await this.startScanning();
        } catch (error) {
          this.logger.error(`[disconnect] Failed to start scanning: ${error.message}`);
        }
      });

      peripheral.on('connect', async () => {
        try {
          await this.startScanning();
        } catch (error) {
          this.logger.error(`[connect] Failed to start scanning: ${error.message}`);
        }

        this.connectedDevices.set(deviceId, peripheral);
        this.connectedDevicesInfo();
        this.logger.log(`Device \x1b[31m${deviceId}\x1b[32m connected successfully.`);

        if (this.allDevicesConnected()) {
          this.logger.log('All devices connected. Stopping scan...');
          await this.stopScanning();
        }
      });

      // Далі можна отримати сервіси та характеристики
      const services = await peripheral.discoverServicesAsync([]);
      this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Discovered services: ${services.length}`);

      for (const service of services) {
        this.logger.log('\x1b[31mservice', service);
        const characteristics = await service.discoverCharacteristicsAsync([]);
        this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Service: ${service.uuid}, Features: ${characteristics.length}`);

        for (const characteristic of characteristics) {
          this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Characteristic: ${characteristic.uuid}, Properties: ${characteristic.properties.join(', ')}`);
          // const data = await characteristic.readAsync();
          // this.logger.log(`Raw Battery Data: ${data.toString('hex')}`);

          // Читання рівня заряду батареї ( не працююче? )
          if (service.uuid === '180f' && characteristic.uuid === '2a19') {
            if (characteristic.properties.includes('read')) {
              const data = await characteristic.readAsync();
              this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Raw Battery Data: ${data.toString('hex')}`);
              const batteryLevel = data.readUInt8(0);
              this.logger.log(`${this.rsColor}Battery Level: ${batteryLevel}%`);
              this.eventEmitter.emit('battery.low', { level: batteryLevel });
            }
          }

          if (service.uuid === '1800') {
            // Це короткий 16 - бітний UUID для сервісу Generic Access.У контексті Bluetooth Low Energy(BLE), 16 - бітні UUID зазвичай зарезервовані для стандартних сервісів, визначених Bluetooth SIG.
            if (characteristic.uuid === '2a00' && characteristic.properties.includes('read')) {
              const data = await characteristic.readAsync();
              this.logger.log(`Device Name: ${data.toString('utf8')}`);
            }
            if (characteristic.uuid === '2a01' && characteristic.properties.includes('read')) {
              const data = await characteristic.readAsync();
              const appearance = data.readUInt16LE(0);
              this.logger.log(`Appearance: ${appearance}`);
            }
          }

          // Якщо характеристика підтримує читання
          if (characteristic.properties.includes('read')) {
            const data = await characteristic.readAsync();
            const utf8String = data.toString('utf8'); // Якщо дані є текстом
            const hexString = data.toString('hex'); // Якщо потрібен формат HEX

            this.logger.log(
              `\x1b[31m[${deviceId}]\x1b[32m Data from characteristic ${characteristic.uuid}: UTF-8: ${utf8String}, HEX: ${hexString}`,
            );
          }

          // Якщо характеристика підтримує підписку (notify)
          if (characteristic.properties.includes('notify')) {
            await characteristic.subscribeAsync();
            characteristic.on('data', (data) => {
              this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Notification from ${characteristic.uuid}: ${data.toString('utf8')}`);
            });
          }
        }
      }
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
    if (!this.activeScan) {
      try {
        // Battery Service '180f'
        this.activeScan = true;
        await noble.startScanningAsync([], true);
        this.logger.log('Scanning has started...');
      } catch (error) {
        this.logger.error(`Scan startup error: ${error.message}`);
        this.activeScan = false;
      }
    }
  }

  private async stopScanning() {
    if (this.activeScan) {
      try {
        await noble.stopScanningAsync();
        this.activeScan = false;
        this.logger.log('Scanning stopped.');
      } catch (error) {
        this.logger.error(`Error stopping scan: ${error.message}`);
      }
    }
  }
}

async function discoverServicesAndCharacteristics(device: noble.Peripheral) {
  try {
    const services = await device.discoverServicesAsync([SERVICE_UUID]);
    for (const service of services) {
      const characteristics = await service.discoverCharacteristicsAsync([CHARACTERISTIC_UUID]);
      for (const characteristic of characteristics) {
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

