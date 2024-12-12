import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';
import { exec } from 'child_process';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);

  async onModuleInit() {
    this.logger.log('Initializing Bluetooth...');
    this.enableBluetoothCLI();
    this.setupBluetooth();
  }

  private enableBluetoothCLI() {
    this.logger.log('Спроба увімкнути Bluetooth через bluetoothctl...');

    exec('bluetoothctl power on', (error, stdout, stderr) => {
      if (error) {
        this.logger.error(`Помилка увімкнення Bluetooth: ${error.message}`);
        return;
      }

      if (stderr) {
        this.logger.error(`Система повідомляє про помилку: ${stderr}`);
        return;
      }

      this.logger.log(`Bluetooth увімкнено: ${stdout}`);
    });

    exec('bluetoothctl agent on', (error, stdout, stderr) => {
      if (error) {
        this.logger.error(`Помилка Bluetooth: ${error.message}`);
        return;
      }

      if (stderr) {
        this.logger.error(`Система повідомляє про помилку: ${stderr}`);
        return;
      }

      this.logger.log(`Bluetooth: ${stdout}`);
    });

    exec('bluetoothctl default-agent', (error, stdout, stderr) => {
      if (error) {
        this.logger.error(`Помилка Bluetooth: ${error.message}`);
        return;
      }

      if (stderr) {
        this.logger.error(`Система повідомляє про помилку: ${stderr}`);
        return;
      }

      this.logger.log(`Bluetooth: ${stdout}`);
    });

    exec('bluetoothctl scan on', (error, stdout, stderr) => {
      if (error) {
        this.logger.error(`Помилка Bluetooth: ${error.message}`);
        return;
      }

      if (stderr) {
        this.logger.error(`Система повідомляє про помилку: ${stderr}`);
        return;
      }

      this.logger.log(`Bluetooth: ${stdout}`);
    });
  }

  private async setupBluetooth() {
    this.logger.log(`Операційна система: ${process.platform}`);

    await noble.startScanningAsync([], true);

    // Коли стан адаптера зміниться
    noble.on('stateChange', async (state) => {
      this.logger.log(`Стан Bluetooth змінився на: ${state}`);

      // Перевіряємо стан більш детально
      if (state === 'unsupported') {
        this.logger.error(
          'Bluetooth Low Energy не підтримується на цьому пристрої',
        );
      } else if (state === 'unauthorized') {
        this.logger.error('Немає прав доступу до Bluetooth');
      } else if (state === 'poweredOff') {
        this.logger.error('Bluetooth вимкнено');
      } else if (state === 'poweredOn') {
        this.logger.log('Bluetooth увімкнено, починаємо сканування...');
        try {
          await noble.startScanningAsync([], true);
          this.logger.log('Сканування успішно запущено');
        } catch (error) {
          this.logger.error(`Помилка при запуску сканування: ${error}`);
        }
      }
    });

    // Коли знайдено пристрій
    noble.on('discover', async (peripheral) => {
      // const localName = peripheral.advertisement.localName || 'Unnamed Device';
      const manufacturerData =
        peripheral.advertisement.manufacturerData?.toString('hex');
      this.logger.log(
        `Знайдено пристрій: ${manufacturerData} ${peripheral.uuid}`,
      );

      // Якщо це потрібний вам пристрій (перевіряємо за виробником)
      if (manufacturerData.startsWith('650b88a0c84780')) {
        //   noble.stopScanning();
        try {
          await this.connectToDevice(peripheral);
        } catch (error) {
          this.logger.error(`Не вдалось підключитись: ${error}`);
        }
      }
    });
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
