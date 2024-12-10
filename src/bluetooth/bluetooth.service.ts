import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);

  async onModuleInit() {
    this.logger.log('Initializing Bluetooth...');
    this.setupBluetooth();
  }

  private setupBluetooth() {
    // Коли стан адаптера зміниться
    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        this.logger.log('Bluetooth адаптер увімкнено, починаємо сканування...');
        // Запускаємо сканування без фільтрів
        await noble.startScanningAsync([], true);
      } else {
        this.logger.log(`Bluetooth адаптер: ${state}`);
        noble.stopScanning();
      }
    });

    // Коли знайдено пристрій
    noble.on('discover', async (peripheral) => {
      // const localName = peripheral.advertisement.localName || 'Unnamed Device';
      const manufacturerData = peripheral.advertisement.manufacturerData;
      this.logger.log(`Знайдено пристрій: ${manufacturerData}`);

      // Якщо це потрібний вам пристрій (перевіряємо за виробником)
      if (
        manufacturerData.toString('hex') ===
        '060001092022e7b9d295c0c68d09812b2b7e23820819189acb01ee2d26'
      ) {
        noble.stopScanning();
        try {
          await this.connectToDevice(peripheral);
        } catch (error) {
          this.logger.error(`Не вдалось підключитись: ${error}`);
        }
      }
    });
  }

  private async connectToDevice(peripheral: noble.Peripheral) {
    this.logger.log(
      `Підключення до ${peripheral.advertisement.manufacturerData}...`,
    );
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
