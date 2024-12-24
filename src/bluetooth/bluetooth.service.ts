import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';
import { config } from 'configs/main.config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  getColorForRSSI,
  startScanning,
  stopScanning,
} from 'src/utils/bluetooth.utils';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 20;

const SERVICE_UUID = 'ffe0';
const CHARACTERISTIC_UUID = 'ffe1';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);
  private connectedDevices: Map<string, noble.Peripheral> = new Map();
  private readonly rsColor = '\x1b[0m';

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
            await discoverServicesAndCharacteristics(peripheral);
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
          await startScanning(this.logger, SERVICE_UUID);
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
    this.logger.log(`Connection to \x1b[31m${deviceId}\x1b[32m...`);

    try {
      await peripheral.connectAsync();
      this.logger.log(`[connectToDevice] Connected to ${deviceId}`);
      // await stopScanning(this.logger); // TODO
      // this.logger.log(`[connectToDevice] Stopped scanning for ${deviceId}`);

      // Слухач на відключення та запуск скану нових повторно
      if (this.connectedDevices.has(deviceId)) {
        peripheral.once('disconnect', async () => {
          this.logger.warn(`${deviceId} disconnected! Restarting scan...`);
          this.connectedDevices.delete(deviceId);
          this.connectedDevicesInfo();
          await startScanning(this.logger, SERVICE_UUID);
        });
      }

      peripheral.on('connect', async () => {
        await startScanning(this.logger, SERVICE_UUID);
        this.connectedDevices.set(deviceId, peripheral);
        this.connectedDevicesInfo();
        this.logger.log(`Device \x1b[31m${deviceId}\x1b[32m connected successfully.`);

        if (this.allDevicesConnected()) {
          this.logger.log('All devices connected. Stopping scan...');
          await stopScanning(this.logger);
        }
      });

      // Далі можна отримати сервіси та характеристики
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const services = await peripheral.discoverServicesAsync([]);
      this.logger.log(`\x1b[31m[${deviceId}]\x1b[32m Discovered services: ${services.length}`);

      for (const service of services) {
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
}

function parseData(data) {
  const frameType = data[4];

  switch (frameType) {
    case 0x01:
      console.log('Device settings frame received');
      decodeSettings(data);
      break;
    case 0x02:
      console.log('Cell information frame received');
      decodeCellInfo(data);
      break;
    default:
      console.warn('Unknown frame type:', frameType);
  }
}

function decodeSettings(data) {
  const cellCount = data.readUInt8(34);
  const startBalanceVoltage = data.readFloatLE(98);
  console.log(`Cell count: ${cellCount}, Start Balance Voltage: ${startBalanceVoltage}V`);
}

function decodeCellInfo(data) {
  const cells = [];
  for (let i = 0; i < 24; i++) {
    const cellVoltage = data.readUInt16LE(6 + i * 2) * 0.001;
    cells.push(cellVoltage);
  }
  console.log('Cell Voltages:', cells);
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

