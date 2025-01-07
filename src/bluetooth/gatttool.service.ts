import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';

@Injectable()
export class GattService {
  private gatttool;

  constructor() {
    this.gatttool = spawn('gatttool', ['-b', 'C8:47:80:12:9B:46', '--interactive']);
    this.gatttool.stdout.setEncoding('utf-8');
    this.gatttool.stdin.write('connect\n');

    this.gatttool.stdout.on('data', (data) => {
      console.log('Received:', data);
    });

    this.gatttool.stderr.on('data', (data) => {
      console.error('Error:', data);
    });

    this.gatttool.on('close', (code) => {
      console.log(`Gatttool closed with code ${code}`);
    });
  }

  async readCharacteristic(handle: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.gatttool.stdin.write(`char-read-hnd ${handle}\n`);
      this.gatttool.stdout.once('data', (data) => {
        const match = data.toString().match(/Characteristic value\/descriptor: (.+)/);
        if (match) {
          resolve(match[1].trim());
        } else {
          reject(new Error('Failed to read characteristic'));
        }
      });
    });
  }

  disconnect() {
    this.gatttool.stdin.write('disconnect\n');
    this.gatttool.stdin.end();
  }
}
