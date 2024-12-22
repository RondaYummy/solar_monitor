import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as noble from '@abandonware/noble';
import { config } from 'configs/main.config';
import { Buffer } from 'node:buffer';

@Injectable()
export class BluetoothService implements OnModuleInit {
  private readonly logger = new Logger(BluetoothService.name);
  private connectedDevices: Map<string, noble.Peripheral> = new Map();

  async onModuleInit() {
    this.logger.log('Initializing Bluetooth... Current state: ' + noble?._state);

    noble.on('discover', async (peripheral) => {
      const manufacturerData =
        peripheral.advertisement.manufacturerData?.toString('hex');
      const localName = peripheral.advertisement.localName;

      // Якщо це потрібний вам пристрій (перевіряємо за виробником або назвою)
      if (
        config.allowedDevices.includes(manufacturerData) ||
        config.allowedDevices.includes(localName)
      ) {
        const deviceId = localName || manufacturerData || peripheral.address;
        if (this.connectedDevices.has(deviceId)) {
          this.logger.log(`Device \x1b[31m${deviceId}\x1b[31m is already connected.`);
          return;
        }

        this.logger.log(
          `[${manufacturerData}] Discovered device: \x1b[31m${deviceId}`,
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

    setInterval(() => {
      const connectedDeviceNames = Array.from(this.connectedDevices.values())
        .map((device) => device.advertisement.localName || device.address)
        .join(', ');

      this.logger.log(`Connected devices: ${connectedDeviceNames || 'None'}`);
    }, 5000); // 5000 мс = 5 секунд
  }

  // private async disconnectFromDevice() {
  //   try {
  //     if (this.connectedDevice?.state === 'connected') {
  //       this.logger.log(
  //         `Disconnecting from \x1b[31m${this.connectedDevice.advertisement.localName || this.connectedDevice.address}\x1b[32m...`,
  //       );
  //       await this.connectedDevice.disconnectAsync();
  //       await this.connectedDevice.removeAllListeners();
  //       this.logger.warn(
  //         `\x1b[34m${this.connectedDevice.advertisement.localName || this.connectedDevice.address} disconnected.`,
  //       );
  //     }

  //     this.connectedDevice = null;
  //   } catch (error) {
  //     this.logger.error(`Error disconnecting from device: ${error.message}`);
  //   }
  // }

  private async startScanning() {
    try {
      // Battery Service '180f'
      await noble.startScanningAsync([], true);
      this.logger.log('Scanning has started...');
    } catch (error) {
      this.logger.error(`Scan startup error: ${error.message}`);
    }
  }

  private async setupBluetooth() {
    // this.logger.log(`Operating system: ${process.platform}`);

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
    const deviceId =
      peripheral.advertisement.localName ||
      peripheral.advertisement.manufacturerData?.toString('hex') ||
      peripheral.address;

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      this.logger.log(
        `Connection to \x1b[31m${peripheral.advertisement.localName || peripheral.address}\x1b[32m...`,
      );
      await peripheral.connectAsync();
      if (peripheral?.state === 'connected') {
        this.logger.log(
          `\x1b[31m${peripheral.advertisement.localName || peripheral.address}\x1b[32m connected!`,
        );
        this.connectedDevices.set(deviceId, peripheral);
        // await this.startScanning();
        // setTimeout(async () => {
        //   await this.disconnectFromDevice();
        //   await this.startScanning();
        // }, 20000);
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
}
