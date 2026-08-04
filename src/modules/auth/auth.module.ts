import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthService, JwksService, OAuthService, PasswordActionService, PkceService, TokenService } from './services';
import { OAuthController, AuthController, JwksController } from './controllers';
import { readJwtKey } from './config/jwt.config';
import { OAUTH_JWT_KEY_ID } from './constants/oauth.constants';
import { UsersModule } from '../users/users.module';
import { AccessModule } from '../access/access.module';
import { SessionGuard } from './guards/session.guard';
import { PasswordChangeGuard } from './guards';
import { EnvironmentVariables } from 'src/config/env.validation';
import { PasswordActionToken } from './entities';
import { MailModule } from '../mail';

@Module({
  controllers: [OAuthController, AuthController, JwksController],
  providers: [
    AuthService,
    OAuthService,
    TokenService,
    PasswordActionService,
    JwksService,
    PkceService,
    {
      provide: APP_GUARD,
      useClass: SessionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PasswordChangeGuard,
    },
  ],
  imports: [
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => {
        return {
          privateKey: readJwtKey(configService.getOrThrow('JWT_PRIVATE_KEY_PATH', { infer: true })),
          publicKey: readJwtKey(configService.getOrThrow('JWT_PUBLIC_KEY_PATH', { infer: true })),
          signOptions: {
            algorithm: 'RS256',
            keyid: OAUTH_JWT_KEY_ID,
            issuer: configService.getOrThrow('IDENTITY_HUB_PUBLIC_URL', { infer: true }),
          },
        };
      },
      inject: [ConfigService],
    }),
    UsersModule,
    AccessModule,
    MailModule,
    TypeOrmModule.forFeature([PasswordActionToken]),
  ],
  exports: [PasswordActionService, TokenService],
})
export class AuthModule {}
