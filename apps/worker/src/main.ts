import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { validateWorkerEnvironment } from './otp-delivery-worker.service.js';

async function bootstrap() {
  validateWorkerEnvironment();
  const app = await NestFactory.create(AppModule);
  // Listen on 0.0.0.0 for Docker compatibility
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Worker is running on: http://localhost:${port}`);
}
bootstrap();
