import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';
import { config } from 'configs/main.config';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);

  async onModuleInit() {
    this.logger.log('Initializing Bluetooth...');

    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        await this.startScanning();
      }
    });

    noble.on('discover', async (peripheral) => {
      const manufacturerData =
        peripheral.advertisement.manufacturerData?.toString('hex');

      // Якщо це потрібний вам пристрій (перевіряємо за виробником або назвою)
      if (
        config.allowedDevices.includes(manufacturerData) ||
        config.allowedDevices.includes(peripheral.advertisement.localName)
      ) {
        this.logger.log(
          `[${manufacturerData}] Discovered device: ${peripheral.address} (${peripheral.advertisement.localName || 'Unknown'})`,
        );
        try {
          await this.connectToDevice(peripheral);
        } catch (error) {
          this.logger.error(`Error discover: ${error}`);
        }
      }
    });

    this.logger.log('Bluetooth initialization complete.');

    await this.setupBluetooth();
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
    this.logger.log(`Current Bluetooth status: ${noble._state}`);

    noble.on('stateChange', async (state) => {
      this.logger.log(`The Bluetooth status has changed to: ${state}`);

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
      `Connection to ${peripheral.advertisement.localName || peripheral.address}...`,
    );
    await peripheral.connectAsync();
    this.logger.log(
      `${peripheral.advertisement.localName || peripheral.address} connected!`,
    );

    // Далі можна отримати сервіси та характеристики
    const services = await peripheral.discoverServicesAsync([]);
    for (const service of services) {
      const characteristics = await service.discoverCharacteristicsAsync([]);
      this.logger.log(
        `Service: ${service.uuid}, Features: ${characteristics.length}`,
      );
    }
  }
}
