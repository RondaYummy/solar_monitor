import * as noble from '@abandonware/noble';

export function getColorForRSSI(rssi: number): string {
  if (rssi >= -60) {
    return '\x1b[34m'; // Синій для сильного сигналу
  } else if (rssi >= -80) {
    return '\x1b[33m'; // Жовтий для середнього сигналу
  } else {
    return '\x1b[31m'; // Червоний для слабкого сигналу
  }
}

export async function startScanning(logger, SERVICE_UUID) {
  try {
    // Battery Service '180f'
    await noble.startScanningAsync([SERVICE_UUID], true);
    logger.log('Scanning has started...');
  } catch (error) {
    logger.error(`Scan startup error: ${error.message}`);
  }
}

export async function stopScanning(logger) {
  try {
    await noble.stopScanningAsync();
    logger.log('Scanning stopped.');
  } catch (error) {
    logger.error(`Error stopping scan: ${error.message}`);
  }
}
