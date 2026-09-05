import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.init();
  const server = app.getHttpServer();
  const router = server._events.request._router;
  console.log(router?.stack?.map((l: any) => l.route?.path).filter(Boolean));
  await app.close();
}
bootstrap();
