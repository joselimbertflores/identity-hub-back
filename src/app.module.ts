import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { RedisModule } from '@nestjs-modules/ioredis';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { join } from 'path';

import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { AccessModule } from './modules/access/access.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { EnvironmentVariables, environmentValidationSchema } from './config';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from './config/rate-limit.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: environmentValidationSchema,
      isGlobal: true,
      cache: true,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
        convert: true,
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => {
        return {
          type: 'postgres',
          host: configService.get('DATABASE_HOST', { infer: true }),
          port: configService.get('DATABASE_PORT', { infer: true }),
          database: configService.get('DATABASE_NAME', { infer: true }),
          username: configService.get('DATABASE_USER', { infer: true }),
          password: configService.get('DATABASE_PASSWORD', { infer: true }),
          autoLoadEntities: true,
          synchronize: configService.get('DATABASE_SYNCHRONIZE', { infer: true }),
        };
      },
      inject: [ConfigService],
    }),
    CacheModule.register({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: RATE_LIMIT_TTL_MS,
        limit: RATE_LIMITS.DEFAULT,
      },
    ]),

    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => ({
        type: 'single',
        url: configService.getOrThrow('REDIS_URL', { infer: true }),
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public', 'browser'),
      exclude: ['/api/{*path}', '/oauth/{*path}', '/.well-known/{*path}', '/internal/{*path}'],
    }),
    AuthModule,
    UsersModule,
    AccessModule,
    ProvisioningModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
