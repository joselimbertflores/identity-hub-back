import { Injectable, UnauthorizedException } from '@nestjs/common';

import { createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class PkceService {
  verifyCodeVerifier(
    codeVerifier: string | undefined,
    expectedCodeChallenge: string | undefined,
    codeChallengeMethod: string | undefined,
  ): void {
    if (!expectedCodeChallenge || codeChallengeMethod !== 'S256') {
      throw new UnauthorizedException('Invalid PKCE challenge.');
    }

    if (!codeVerifier) {
      throw new UnauthorizedException('code_verifier is required.');
    }

    const actualCodeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    if (!this.safeEqual(actualCodeChallenge, expectedCodeChallenge)) {
      throw new UnauthorizedException('Invalid code_verifier.');
    }
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}
