import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(cookieParser());

  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({ origin: 'http://localhost:4200', credentials: true });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
