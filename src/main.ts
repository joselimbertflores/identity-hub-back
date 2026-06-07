import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { EnvironmentVariables } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<EnvironmentVariables>);

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

  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin, credentials: true });
  }

  await app.listen(configService.get<number>('PORT') ?? 3000);
}
void bootstrap();
