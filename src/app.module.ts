import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BluetoothService } from './bluetooth/bluetooth.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, BluetoothService],
})
export class AppModule {}
