import { plainToInstance, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  Max,
  Min,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  validateSync,
} from 'class-validator';

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

  @IsIn(['true', 'false'])
  DB_SYNCHRONIZE: 'true' | 'false';

  @IsString()
  @IsNotEmpty()
  REDIS_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY_PATH: string;

  @IsString()
  @IsNotEmpty()
  JWT_PRIVATE_KEY_PATH: string;

  @IsBoolean()
  IDENTITY_COOKIE_SECURE: boolean;

  @IsOptional()
  @IsUrl({ require_tld: false })
  CORS_ORIGIN?: string;

  @IsString()
  @IsNotEmpty()
  JWT_ISSUER: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  IDENTITY_HUB_UI_BASE_URL: string;

  @IsString()
  @Matches(/^\/[A-Za-z0-9/_-]*$/, {
    message: 'IDENTITY_HUB_UI_CHANGE_PASSWORD_PATH must be a relative UI path',
  })
  IDENTITY_HUB_UI_CHANGE_PASSWORD_PATH: string;

  @IsString()
  @Matches(/^\/[A-Za-z0-9/_-]*$/, {
    message: 'PASSWORD_ACTION_UI_PATH must be a relative UI path',
  })
  PASSWORD_ACTION_UI_PATH: string;

  @IsInt()
  @Min(900)
  @Max(604800)
   @Type(() => Number) 
  PASSWORD_INITIAL_SETUP_TTL_SECONDS = 24 * 60 * 60;

  @IsInt()
  @Min(300)
  @Max(86400)
   @Type(() => Number) 
  PASSWORD_RESET_TTL_SECONDS = 60 * 60;

  @IsString()
  @IsNotEmpty()
  SMTP_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number;

  @IsIn(['true', 'false'])
  SMTP_SECURE: 'true' | 'false';

  @IsOptional()
  @IsString()
  SMTP_USERNAME?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsEmail()
  SMTP_FROM_ADDRESS: string;

  @IsString()
  @IsNotEmpty()
  SMTP_FROM_NAME: string;
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
  if (Boolean(validatedConfig.SMTP_USERNAME) !== Boolean(validatedConfig.SMTP_PASSWORD)) {
    throw new Error('SMTP_USERNAME and SMTP_PASSWORD must be configured together');
  }
  return validatedConfig;
}
