import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by').disable('etag');

  await app.listen(3000);
  console.log(`🟢 Application is running on: ${await app.getUrl()}`);
}
bootstrap();
