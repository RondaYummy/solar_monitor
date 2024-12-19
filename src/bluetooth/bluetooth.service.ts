import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';

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
    this.logger.log('Bluetooth initialization complete.');

    await this.setupBluetooth();
  }

  private async startScanning() {
    this.logger.log('Запускаємо сканування...');
    try {
      await noble.startScanningAsync([], true);
      this.logger.log('Сканування запущено');
    } catch (error) {
      this.logger.error(`Помилка запуску сканування: ${error.message}`);
    }
  }

  private async setupBluetooth() {
    this.logger.log(`Операційна система: ${process.platform}`);

    noble.on('stateChange', async (state) => {
      this.logger.log(`Стан Bluetooth змінився на: ${state}`);

      if (state === 'poweredOn') {
        this.logger.log('Bluetooth увімкнено, запускаємо сканування...');
        try {
          await noble.startScanningAsync([], true);
          this.logger.log('Сканування успішно запущено');
        } catch (error) {
          this.logger.error(`Помилка при запуску сканування: ${error.message}`);
        }
      } else {
        this.logger.warn(`Bluetooth не готовий: ${state}`);
      }
    });

    this.logger.log(`Поточний стан Bluetooth: ${noble.state}`);

    if (noble.state === 'poweredOn') {
      this.logger.log('Bluetooth вже увімкнено, запускаємо сканування...');
      try {
        await noble.startScanningAsync([], true);
        this.logger.log('Сканування успішно запущено');
      } catch (error) {
        this.logger.error(`Помилка при запуску сканування: ${error.message}`);
      }
    }
  }

  private async connectToDevice(peripheral: noble.Peripheral) {
    this.logger.log(`Підключення...`);
    await peripheral.connectAsync();
    this.logger.log('Підключено!');

    // Далі можна отримати сервіси та характеристики
    const services = await peripheral.discoverServicesAsync([]);
    for (const service of services) {
      const characteristics = await service.discoverCharacteristicsAsync([]);
      this.logger.log(
        `Сервіс: ${service.uuid}, Характеристик: ${characteristics.length}`,
      );
    }

    // Якщо потрібна взаємодія з конкретним сервісом/характеристикою - робіть її тут.
  }
}
