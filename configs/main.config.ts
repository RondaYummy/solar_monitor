interface AllowedDevice {
  localName: string;
  address: string;
}

interface Config {
  allowedDevices: Array<AllowedDevice>;
}

export const config: Config = {
  allowedDevices: [{
    localName: 'Andrii 1',
    address: 'c8:47:80:12:9b:46',
  }, {
    localName: 'Andrii 2',
    address: 'c8:47:80:21:bc:f4',
  }, {
    localName: 'Andrii 3',
    address: 'c8:47:80:12:41:99',
  }, {
    localName: 'Andrii4',
    address: 'c8:47:80:21:34:82',
  }
  ],
};
