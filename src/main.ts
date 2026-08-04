import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { EnvironmentVariables } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<EnvironmentVariables, true>);

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'oauth/{*path}', method: RequestMethod.ALL },
      { path: '.well-known/{*path}', method: RequestMethod.ALL },
      { path: 'internal/{*path}', method: RequestMethod.ALL },
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

  const publicOrigin = new URL(configService.getOrThrow('IDENTITY_HUB_PUBLIC_URL', { infer: true })).origin;
  const uiOrigin = new URL(configService.getOrThrow('IDENTITY_HUB_UI_URL', { infer: true })).origin;
  if (uiOrigin !== publicOrigin) {
    app.enableCors({ origin: uiOrigin, credentials: true });
  }

  await app.listen(configService.getOrThrow('PORT', { infer: true }), "192.168.30.34");
}
void bootstrap();
