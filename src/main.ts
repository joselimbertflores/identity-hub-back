import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'oauth/{*path}', method: RequestMethod.ALL },
      { path: '.well-known/{*path}', method: RequestMethod.ALL },
    ],
  });
  
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (process.env.NODE_ENV === 'development' && process.env.CORS_ORIGIN) {
    app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
