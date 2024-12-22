import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Api, Bot, Context, RawApi } from 'grammy';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class TelegramService implements OnModuleInit {
  readonly bot: Bot<Context, Api<RawApi>>;
  readonly channelId: string;
  private logger = new Logger(TelegramService.name);

  async onModuleInit() {
    const message = `⚠️ Low battery detected: ${payload.level}%`;
    await this.sendMessage(message);

    this.bot.start({
      allowed_updates: ['message', 'callback_query'],
    });
    this.logger.log('Telegram bot started');
  }

  constructor(private configService: ConfigService) {
    try {
      this.bot = new Bot<Context>(this.configService.get<string>('TELEGRAM_BOT_TOKEN'));
      this.channelId = this.configService.get<string>('TELEGRAM_CHANNEL_ID');
    } catch (error) {
      console.error(error);
      this.logger.error(error);
      return error;
    }
  }

  @OnEvent('battery.low')
  async handleLowBatteryEvent(payload: { level: number; }) {
    const message = `⚠️ Low battery detected: ${payload.level}%`;
    await this.sendMessage(message);
  }

  async sendMessage(text: string, channelId: string = this.channelId) {
    try {
      await this.bot.api.sendMessage(channelId, text);
      this.logger.log(`Message sent to channel ${channelId}: ${text}`);
    } catch (error) {
      this.logger.error(`Failed to send message to channel ${channelId}: ${error}`);
    }
  }
}
