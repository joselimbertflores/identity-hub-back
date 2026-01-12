import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { JwtService } from '@nestjs/jwt';

import Redis from 'ioredis';

import { AccessTokenPayload, RefreshTokenPayload } from '../interfaces';

@Injectable()
export class TokenService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private jwtService: JwtService,
  ) {}

  async generateTokenPair(payload: AccessTokenPayload) {
    // TTL 15min
    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: '1h' });
    const refreshToken = crypto.randomUUID();

    const data: RefreshTokenPayload = {
      userId: payload.sub,
      clientId: payload.clientId,
      scope: payload.scope,
    };
    const REFRESH_TTL_SECONDS = 10 * 60 * 60;
    await this.redis.set(`refresh:${refreshToken}`, JSON.stringify(data), 'EX', REFRESH_TTL_SECONDS);
    await this.redis.sadd(`user_refresh_tokens:${payload.sub}`, refreshToken);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: 3600, // seg
      refreshTokenExpiresIn: REFRESH_TTL_SECONDS,
      tokenType: 'Bearer',
    };
  }

  async consumeRefreshToken(refreshToken: string) {
    const key = `refresh:${refreshToken}`;
    const raw = await this.redis.get(key);

    if (!raw) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const data = JSON.parse(raw) as RefreshTokenPayload;

    await this.redis.del(key);
    await this.redis.srem(`user_refresh_tokens:${data.userId}`, refreshToken);

    return data;
  }

  async revokeAllForUser(userId: string) {
    const setKey = `user_refresh_tokens:${userId}`;
    const tokens = await this.redis.smembers(setKey);

    if (tokens.length === 0) return;

    const pipeline = this.redis.pipeline();

    for (const token of tokens) {
      pipeline.del(`refresh:${token}`);
    }

    pipeline.del(setKey);
    await pipeline.exec();
  }
}
