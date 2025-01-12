import { Injectable } from '@nestjs/common';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

@Injectable()
export class GattService {
  private gatttool: ChildProcessWithoutNullStreams;
  private isConnected: boolean = false;

  constructor() {
    this.gatttool = spawn('gatttool', ['-b', 'C8:47:80:12:9B:46', '--interactive']);
    this.gatttool.stdout.setEncoding('utf-8');

    this.gatttool.stdout.on('data', (data) => {
      console.log('Received:', data);
      if (data.includes('Connection successful')) {
        this.isConnected = true;
      }
    });

    this.gatttool.stderr.on('data', (data) => {
      console.error('Error:', data);
    });

    this.gatttool.on('close', (code) => {
      console.log(`Gatttool closed with code ${code}`);
    });

    this.connect();
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gatttool.stdin.write('connect\n');

      this.gatttool.stdout.once('data', (data) => {
        if (data.includes('Connection successful')) {
          this.isConnected = true;
          resolve();
        } else {
          reject(new Error('Failed to connect to device'));
        }
      });
    });
  }

  async activateNotifications(handle: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Device not connected');
    }

    return new Promise((resolve, reject) => {
      // Команда для активації нотифікацій через запис у відповідний дескриптор
      this.gatttool.stdin.write(`char-write-req ${handle} 0100\n`);

      this.gatttool.stdout.once('data', (data) => {
        if (data.includes('Characteristic value was written successfully')) {
          console.log(`Notifications activated on handle ${handle}`);
          resolve();
        } else {
          reject(new Error('Failed to activate notifications'));
        }
      });
    });
  }

  async readCharacteristic(handle: string): Promise<string> {
    if (!this.isConnected) {
      throw new Error('Device not connected');
    }

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

  listenForNotifications(): void {
    if (!this.isConnected) {
      throw new Error('Device not connected');
    }

    this.gatttool.stdout.on('data', (data) => {
      if (data.includes('Notification handle')) {
        const match = data.toString().match(/Notification handle = [0-9a-fx]+ value: (.+)/);
        if (match) {
          console.log(`Notification received: ${match[1].trim()}`);
        }
      }
    });
  }

  disconnect(): void {
    if (this.isConnected) {
      this.gatttool.stdin.write('disconnect\n');
      this.gatttool.stdin.end();
      this.isConnected = false;
      console.log('Disconnected from device.');
    }
  }
}
