export function prepareMessage(payload: { devices: Array<{ localName: string; address: string; }>; }) {
  let message = 'Connected devices:\n';

  for (const dev of payload.devices) {
    message += `[${dev.address}] ${dev.localName}\n`;
  }

  return message;
}
