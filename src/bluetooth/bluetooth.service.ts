import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';
import { config } from 'configs/main.config';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);
  private connectedDevice: noble.Peripheral | null = null;

  async onModuleInit() {
    this.logger.log('Initializing Bluetooth...');

    noble.on('discover', async (peripheral) => {
      const manufacturerData =
        peripheral.advertisement.manufacturerData?.toString('hex');

      // Якщо це потрібний вам пристрій (перевіряємо за виробником або назвою)
      if (
        config.allowedDevices.includes(manufacturerData) ||
        config.allowedDevices.includes(peripheral.advertisement.localName)
      ) {
        this.logger.log(
          `[${manufacturerData}] Discovered device: ${peripheral.address} (\x1b[31m${peripheral.advertisement.localName || 'Unknown'}\x1b[32m)`,
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

    this.logger.log('Bluetooth initialization complete.');
    await this.setupBluetooth();
  }

  private async disconnectFromDevice() {
    try {
      if (this.connectedDevice?.state === 'connected') {
        this.logger.log(
          `Disconnecting from \x1b[31m${this.connectedDevice.advertisement.localName || this.connectedDevice.address}\x1b[32m...`,
        );
        await this.connectedDevice.disconnectAsync();
        await this.connectedDevice.removeAllListeners();
        this.logger.warn(
          `\x1b[34m${this.connectedDevice.advertisement.localName || this.connectedDevice.address} disconnected.`,
        );
      }

      this.connectedDevice = null;
    } catch (error) {
      this.logger.error(`Error disconnecting from device: ${error.message}`);
    }
  }

  private async startScanning() {
    try {
      await noble.startScanningAsync([], true);
      this.logger.log('Scanning has started...');
    } catch (error) {
      this.logger.error(`Scan startup error: ${error.message}`);
    }
  }

  private async setupBluetooth() {
    this.logger.log(`Operating system: ${process.platform}`);

    noble.on('stateChange', async (state) => {
      this.logger.log(
        `The Bluetooth status has changed to: \x1b[31m${state}\x1b[32m.`,
      );

      if (state === 'poweredOn') {
        this.logger.log('Bluetooth is turned on, start scanning...');
        try {
          await this.startScanning();
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
        await this.startScanning();
      } catch (error) {
        this.logger.error(
          `[setupBluetooth] Scan startup error: ${error.message}`,
        );
      }
    }
  }

  private async connectToDevice(peripheral: noble.Peripheral) {
    this.logger.log(
      `Connection to \x1b[31m${peripheral.advertisement.localName || peripheral.address}\x1b[32m...`,
    );
    await peripheral.connectAsync();
    if (peripheral?.state === 'connected') {
      this.logger.log(
        `\x1b[31m${peripheral.advertisement.localName || peripheral.address}\x1b[32m connected!`,
      );
      this.connectedDevice = peripheral;

      setTimeout(async () => {
        await this.disconnectFromDevice();
        await this.startScanning();
      }, 20000);
    } else {
      this.logger.warn('Device is not connected.');
    }

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
            this.logger.log(`\x1b[0mФФФФФФФФФФФФФФФФФФФ: ${batteryLevel}%`);
          }
        }

        // Читання рівня заряду батареї
        if (service.uuid === '180f' && characteristic.uuid === '2a19') {
          if (characteristic.properties.includes('read')) {
            const data = await characteristic.readAsync();
            this.logger.log(`Raw Battery Data: ${data.toString('hex')}`);
            const batteryLevel = data.readUInt8(0);
            this.logger.log(`\x1b[0mBattery Level: ${batteryLevel}%`);
          }
        }

        // Якщо характеристика підтримує читання
        if (characteristic.properties.includes('read')) {
          const data = await characteristic.readAsync();
          this.logger.log(
            `Data from characteristic ${characteristic.uuid}: ${Buffer.from(data.toString('hex'), 'hex').toString('utf8')}`,
          );
        }

        // Якщо характеристика підтримує підписку (notify)
        if (characteristic.properties.includes('notify')) {
          await characteristic.subscribeAsync();
          characteristic.on('data', (data) => {
            this.logger.log(
              `Notification from ${characteristic.uuid}: ${data.toString('hex')}`,
            );
          });
        }
      }
    }
  }
}
