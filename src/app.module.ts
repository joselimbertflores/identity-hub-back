import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { RedisModule } from '@nestjs-modules/ioredis';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';

import { join } from 'path';

import { PrinterModule } from './modules/printer/printer.module';
import { AccessModule } from './modules/access/access.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { EnvironmentVariables, validate } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate,
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService<EnvironmentVariables>) => {
        const isProduction = configService.get<string>('NODE_ENV') === 'production';

        return {
          type: 'postgres',
          host: configService.get('DATABASE_HOST'),
          port: +configService.get('DATABASE_PORT'),
          database: configService.get('DATABASE_NAME'),
          username: configService.get('DATABASE_USER'),
          password: configService.get('DATABASE_PASSWORD'),
          autoLoadEntities: true,
          synchronize: !isProduction,
        };
      },
      inject: [ConfigService],
    }),
    CacheModule.register({ isGlobal: true }),

    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService<EnvironmentVariables>) => ({
        type: 'single',
        url: configService.getOrThrow<string>('REDIS_URL'),
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/{*path}', '/oauth/{*path}', '/.well-known/{*path}'],
    }),
    AuthModule,
    UsersModule,
    AccessModule,
    PrinterModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
