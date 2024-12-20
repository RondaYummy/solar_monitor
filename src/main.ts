import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by').disable('etag');

  await app.listen(3000);
  logger.log(`🟢 Application is running on: ${await app.getUrl()}`);
}
bootstrap();
