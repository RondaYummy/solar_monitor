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
          `[${manufacturerData}] Discovered device: ${peripheral.address} (\x1b[31m${peripheral.advertisement.localName || 'Unknown'}\x1b[0m)`,
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
      console.log(this.connectedDevice.state);

      this.logger.log(
        `Disconnecting from \x1b[31m${this.connectedDevice.advertisement.localName || this.connectedDevice.address}\x1b[0m...`,
      );
      await this.connectedDevice.disconnectAsync();
      this.connectedDevice.removeAllListeners();
      this.logger.warn(
        `\x1b[34m${this.connectedDevice.advertisement.localName || this.connectedDevice.address} disconnected.`,
      );
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

    if (noble._state === 'poweredOn') {
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
    if (peripheral.state === 'connected') {
      this.logger.log(
        `\x1b[31m${peripheral.advertisement.localName || peripheral.address}\x1b[32m connected!`,
      );
      this.connectedDevice = peripheral;

      setTimeout(async () => {
        await this.disconnectFromDevice();
        await this.startScanning();
      }, 10000);
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
    }
  }
}
