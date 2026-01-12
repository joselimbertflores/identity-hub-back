import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createPublicKey } from 'crypto';
import path from 'path';
import * as fs from 'fs';

@Injectable()
export class JwksService {
  private readonly jwks: { keys: object[] };

  constructor(configService: ConfigService) {
    const publicKeyPath = path.join(process.cwd(), configService.getOrThrow<string>('JWT_PUBLIC_KEY_PATH'));
    const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8');
    const keyObject = createPublicKey(publicKeyPem);
    const jwk = keyObject.export({ format: 'jwk' });

    this.jwks = {
      keys: [
        {
          ...jwk,
          use: 'sig',
          alg: 'RS256',
          kid: 'main-key',
        },
      ],
    };
  }

  getJwks() {
    return this.jwks;
  }
}
