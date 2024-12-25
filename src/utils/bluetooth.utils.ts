export function getColorForRSSI(rssi: number): string {
  if (rssi >= -60) {
    return '\x1b[34m'; // Синій для сильного сигналу
  } else if (rssi >= -80) {
    return '\x1b[33m'; // Жовтий для середнього сигналу
  } else {
    return '\x1b[31m'; // Червоний для слабкого сигналу
  }
}

export function parseData(data) {

  switch (frameType) {
    case 0x01:
      console.log('Device settings frame received');
      decodeSettings(data);
      break;
    case 0x02:
      console.log('Cell information frame received');
      decodeCellInfo(data);
      break;
    default:
      console.warn('Unknown frame type:', frameType);
  }
}

export function decodeSettings(data) {
  const cellCount = data.readUInt8(34);
  const startBalanceVoltage = data.readFloatLE(98);
  console.log(`Cell count: ${cellCount}, Start Balance Voltage: ${startBalanceVoltage}V`);
}

export function decodeCellInfo(data) {
  const cells = [];
  for (let i = 0; i < 24; i++) {
    const cellVoltage = data.readUInt16LE(6 + i * 2) * 0.001;
    cells.push(cellVoltage);
  }
  console.log('Cell Voltages:', cells);
}
