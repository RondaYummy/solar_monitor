import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';
import { config } from 'configs/main.config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getColorForRSSI, startScanning, stopScanning } from 'src/utils/bluetooth.utils';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);
  private connectedDevices: Map<string, noble.Peripheral> = new Map();
  private readonly rsColor = '\x1b[0m';

  constructor(private eventEmitter: EventEmitter2) { }

  async onModuleInit() {
    this.logger.log(
      'Initializing Bluetooth... Current state: ' + noble?._state,
    );

    noble.on('discover', async (peripheral) => {
      const manufacturerData =
        peripheral.advertisement.manufacturerData?.toString('hex');
      const localName = peripheral.advertisement.localName;

      if (
        config.allowedDevices.includes(manufacturerData) ||
        config.allowedDevices.includes(localName)
      ) {
        const deviceId = localName || manufacturerData || peripheral.address;
        if (this.connectedDevices.has(deviceId) && peripheral.state === 'connected') {
          this.logger.log(
            `Device \x1b[31m${deviceId}\x1b[31m is already connected.`,
          );
          return;
        }

        const rssiColor = getColorForRSSI(peripheral.rssi);
        this.logger.log(
          `Discovered peripheral: \x1b[31m${deviceId}\x1b[32m, RSSI: ${rssiColor}${peripheral.rssi}${this.rsColor}`,
        );
        try {
          await this.connectToDevice(peripheral);
        } catch (error) {
          this.logger.error(`Error discover: ${error}`);
        }
      }
    });

    noble.on('warning', (message) => {
      this.logger.warn(`Warning: ${message}`);
    });
    noble.on('uncaughtException', (error) => {
      this.logger.error(`Uncaught exception: ${error}`);
    });
    noble.on('error', (error) => {
      this.logger.error(`\x1b[31mPeripheral error: ${error.message}`);
    });

    this.logger.log('Bluetooth initialization complete.');
    await this.setupBluetooth();
  }

  private async setupBluetooth() {
    noble.on('stateChange', async (state) => {
      this.logger.log(
        `The Bluetooth status has changed to: \x1b[31m${state}\x1b[32m.`,
      );

      if (state === 'poweredOn') {
        this.logger.log('Bluetooth is turned on, start scanning...');
        try {
          await startScanning();
        } catch (error) {
          this.logger.error(`[poweredOn] Scan startup error: ${error.message}`);
        }
      } else {
        this.logger.warn(`Bluetooth is not ready: ${state}`);
      }
    });

    if (noble?._state === 'poweredOn') {
      this.logger.log('Bluetooth is already on, start scanning...');
      try {
        await startScanning();
      } catch (error) {
        this.logger.error(
          `[setupBluetooth] Scan startup error: ${error.message}`,
        );
      }
    }
  }

  private async connectToDevice(peripheral: noble.Peripheral) {
    const deviceId =
      peripheral.advertisement.localName ||
      peripheral.advertisement.manufacturerData?.toString('hex') ||
      peripheral.address;

    try {
      this.logger.log(
        `Connection to \x1b[31m${peripheral.advertisement.localName || peripheral.address}\x1b[32m...`,
      );

      await stopScanning();
      await peripheral.connectAsync();

      // Слухач на відключення та запуск скану нових повторно
      peripheral.once('disconnect', async () => {
        this.logger.warn(`${deviceId} disconnected! Restarting scan...`);
        this.connectedDevices.delete(deviceId);
        this.connectedDevicesInfo();
        await startScanning();
      });

      peripheral.on('connect', async () => {
        await startScanning();
        this.connectedDevices.set(deviceId, peripheral);
        this.connectedDevicesInfo();
        this.logger.log(`Device \x1b[31m${deviceId}\x1b[32m connected successfully.`);

        if (this.allDevicesConnected()) {
          this.logger.log('All devices connected. Stopping scan...');
          await stopScanning();
        }
      });


      // Далі можна отримати сервіси та характеристики
      const services = await peripheral.discoverServicesAsync([]);
      console.log(services, 'services');

      for (const service of services) {
        const characteristics = await service.discoverCharacteristicsAsync([]);
        this.logger.log(
          `Service: ${service.uuid}, Features: ${characteristics.length}`,
        );

        for (const characteristic of characteristics) {
          this.logger.log(
            `Characteristic: ${characteristic.uuid}, Properties: ${characteristic.properties.join(', ')}`,
          );

          if (characteristic.uuid === 'f000ffc0-0451-4000-b000-000000000000') {
            if (characteristic.properties.includes('read')) {
              const data = await characteristic.readAsync();
              this.logger.log(
                `ФФФФФФФФФФФФФФФФФФФФФФФФФФФФФФФФФ: ${data.toString('hex')}`,
              );
              const batteryLevel = data.readUInt8(0);
              this.logger.log(
                `${this.rsColor}ФФФФФФФФФФФФФФФФФФФ: ${batteryLevel}%`,
              );
            }
          }

          // Читання рівня заряду батареї
          if (service.uuid === '180f' && characteristic.uuid === '2a19') {
            if (characteristic.properties.includes('read')) {
              const data = await characteristic.readAsync();
              this.logger.log(`Raw Battery Data: ${data.toString('hex')}`);
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
              `Data from characteristic ${characteristic.uuid}: UTF-8: ${utf8String}, HEX: ${hexString}`,
            );
          }

          // Якщо характеристика підтримує підписку (notify)
          if (characteristic.properties.includes('notify')) {
            await characteristic.subscribeAsync();
            characteristic.on('data', (data) => {
              this.logger.log(
                `Notification from ${characteristic.uuid}: ${data.toString('utf8')}`,
              );
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error connecting to device ${deviceId}: ${error}`);
      if (peripheral.state === 'connected') {
        await peripheral.disconnectAsync();
      }
    }
  }

  async disconnectAllDevices() {
    this.logger.log('Disconnecting all devices...');
    for (const [deviceId, peripheral] of this.connectedDevices.entries()) {
      try {
        if (peripheral.state === 'connected') {
          await peripheral.disconnectAsync();
          this.logger.log(`Disconnected device ${deviceId}.`);
        }
      } catch (error) {
        this.logger.error(`Error disconnecting device ${deviceId}: ${error}`);
      }
    }
    this.connectedDevices.clear();
  }

  private allDevicesConnected(): boolean {
    const allowedDevices = config.allowedDevices;
    return allowedDevices.every((deviceId) =>
      this.connectedDevices.has(deviceId),
    );
  }

  private connectedDevicesInfo(): void {
    const connectedDeviceNames = Array.from(this.connectedDevices.values())
      .map((device) => device.advertisement.localName || device.address)
      .join(', ');
    this.eventEmitter.emit('devices.connected', {
      devices: connectedDeviceNames,
    });
  }
}
