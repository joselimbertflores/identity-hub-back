import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthService, JwksService, OAuthService, TokenService } from './services';
import { OAuthController, AuthController, JwksController } from './controllers';
import { jwtPrivateKey, jwtPublicKey } from './config/jwt.config';
import { UsersModule } from '../users/users.module';
import { AccessModule } from '../access/access.module';
import { SessionGuard } from './guards/session.guard';
import { PasswordChangeGuard } from './guards';
import { EnvironmentVariables } from 'src/config/env.validation';
import { ConfigService } from '@nestjs/config';

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
          privateKey: jwtPrivateKey,
          publicKey: jwtPublicKey,
          signOptions: {
            algorithm: 'RS256',
            keyid: 'main-key',
            issuer: configService.getOrThrow<string>('JWT_ISSUER'),
          },
        };
      },
    }),
    UsersModule,
    AccessModule,
  ],
})
export class AuthModule {}
