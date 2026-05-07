import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { AuthService, JwksService, OAuthService, TokenService } from './services';
import { OAuthController, AuthController, JwksController } from './controllers';
import { readJwtKey } from './config/jwt.config';
import { OAUTH_JWT_KEY_ID } from './constants/oauth.constants';
import { UsersModule } from '../users/users.module';
import { AccessModule } from '../access/access.module';
import { SessionGuard } from './guards/session.guard';
import { PasswordChangeGuard } from './guards';
import { EnvironmentVariables } from 'src/config/env.validation';

@Module({
  controllers: [OAuthController, AuthController, JwksController],
  providers: [
    AuthService,
    OAuthService,
    TokenService,
    JwksService,
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
      useFactory: (configService: ConfigService<EnvironmentVariables>) => {
        return {
          privateKey: readJwtKey(configService.getOrThrow('JWT_PRIVATE_KEY_PATH')),
          publicKey: readJwtKey(configService.getOrThrow('JWT_PUBLIC_KEY_PATH')),
          signOptions: {
            algorithm: 'RS256',
            keyid: OAUTH_JWT_KEY_ID,
            issuer: configService.getOrThrow<string>('JWT_ISSUER'),
          },
        };
      },
      inject: [ConfigService],
    }),
    UsersModule,
    AccessModule,
  ],
})
export class AuthModule {}
