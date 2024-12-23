import * as noble from '@abandonware/noble';
import { config } from 'configs/main.config';

export function getColorForRSSI(rssi: number): string {
  if (rssi >= -60) {
    return '\x1b[34m'; // Синій для сильного сигналу
  } else if (rssi >= -80) {
    return '\x1b[33m'; // Жовтий для середнього сигналу
  } else {
    return '\x1b[31m'; // Червоний для слабкого сигналу
  }
}

export async function startScanning() {
  try {
    // Battery Service '180f'
    await noble.startScanningAsync([], true);
    this.logger.log('Scanning has started...');
  } catch (error) {
    this.logger.error(`Scan startup error: ${error.message}`);
  }
}

export async function stopScanning() {
  try {
    await noble.stopScanningAsync();
    this.logger.log('Scanning stopped.');
  } catch (error) {
    this.logger.error(`Error stopping scan: ${error.message}`);
  }
}

export async function disconnectAllDevices() {
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

export function allDevicesConnected(): boolean {
  const allowedDevices = config.allowedDevices;
  return allowedDevices.every((deviceId) =>
    this.connectedDevices.has(deviceId),
  );
}
