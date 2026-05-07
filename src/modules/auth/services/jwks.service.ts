import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createPublicKey } from 'crypto';

import { EnvironmentVariables } from 'src/config';

import { readJwtKey } from '../config/jwt.config';
import { OAUTH_JWT_KEY_ID } from '../constants/oauth.constants';

@Injectable()
export class JwksService {
  private readonly jwks: { keys: object[] };

  constructor(configService: ConfigService<EnvironmentVariables>) {
    const publicKeyPem = readJwtKey(configService.getOrThrow('JWT_PUBLIC_KEY_PATH'));
    const keyObject = createPublicKey(publicKeyPem);
    const jwk = keyObject.export({ format: 'jwk' });

    this.jwks = {
      keys: [
        {
          ...jwk,
          use: 'sig',
          alg: 'RS256',
          kid: OAUTH_JWT_KEY_ID,
        },
      ],
    };
  }

  getJwks() {
    return this.jwks;
  }
}
