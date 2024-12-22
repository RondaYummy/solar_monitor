import { Injectable, Logger } from '@nestjs/common';
import { Api, Bot, Context, RawApi } from 'grammy';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramService {
  readonly bot: Bot<Context, Api<RawApi>>;
  private logger = new Logger(TelegramService.name);

  constructor(private configService: ConfigService) {
    try {
      this.bot = new Bot<Context>(this.configService.get<string>('TELEGRAM_BOT_TOKEN'));

      this.bot.start({
        allowed_updates: ['message', 'callback_query'],
      });
    } catch (error) {
      console.error(error);
      this.logger.error(error);
      return error;
    }
  }
}
