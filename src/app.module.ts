import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BluetoothService } from './bluetooth/bluetooth.service';
import { TelegramModule } from './telegram/telegram.module';
import { validate } from './env.validation';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TelegramModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
  ],
  controllers: [AppController],
  providers: [AppService, BluetoothService],
})
export class AppModule { }
