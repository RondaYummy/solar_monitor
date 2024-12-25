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
