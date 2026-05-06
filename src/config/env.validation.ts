import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsNumber()
  PORT: number;

  @IsString()
  DATABASE_HOST: string;

  @IsNumber()
  DATABASE_PORT: number;

  @IsString()
  DATABASE_NAME: string;

  @IsString()
  DATABASE_USER: string;

  @IsString()
  DATABASE_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL: string;

  @IsString()
  @IsNotEmpty()
  IDENTITY_HUB_HOME_PATH: string;

  @IsString()
  @IsNotEmpty()
  IDENTITY_HUB_LOGIN_PATH: string;

  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY_PATH: string;

  @IsString()
  @IsNotEmpty()
  JWT_PRIVATE_KEY_PATH: string;

  @IsBoolean()
  IDENTITY_COOKIE_SECURE: boolean;

  @IsIn(['development', 'production'])
  NODE_ENV: 'development' | 'production';

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  @IsString()
  @IsNotEmpty()
  JWT_ISSUER: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
