import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { JwtService } from '@nestjs/jwt';

import Redis from 'ioredis';

import { AccessTokenPayload, RefreshTokenPayload } from '../interfaces';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_KEY_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  USER_REFRESH_TOKENS_KEY_PREFIX,
} from '../constants/oauth.constants';

@Injectable()
export class TokenService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private jwtService: JwtService,
  ) {}

  async generateTokenPair(payload: AccessTokenPayload) {
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      audience: payload.clientId,
    });

    const refreshToken = crypto.randomUUID();
    const refreshTokenKey = this.buildRefreshTokenKey(refreshToken);
    const userRefreshTokensKey = this.buildUserRefreshTokensKey(payload.sub);

    const data: RefreshTokenPayload = {
      userId: payload.sub,
      clientId: payload.clientId,
      scope: payload.scope,
    };

    await this.redis.set(refreshTokenKey, JSON.stringify(data), 'EX', REFRESH_TOKEN_TTL_SECONDS);

    const pipeline = this.redis.pipeline();
    pipeline.sadd(userRefreshTokensKey, refreshToken);
    pipeline.expire(userRefreshTokensKey, REFRESH_TOKEN_TTL_SECONDS);
    await pipeline.exec();

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
    };
  }

  async consumeRefreshToken(refreshToken: string) {
    const raw = await this.redis.getdel(this.buildRefreshTokenKey(refreshToken));

    if (!raw) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const data = JSON.parse(raw) as RefreshTokenPayload;

    await this.redis.srem(this.buildUserRefreshTokensKey(data.userId), refreshToken);

    return data;
  }

  async revokeAllForUser(userId: string) {
    const setKey = this.buildUserRefreshTokensKey(userId);
    const tokens = await this.redis.smembers(setKey);

    const pipeline = this.redis.pipeline();

    for (const token of tokens) {
      pipeline.del(this.buildRefreshTokenKey(token));
    }

    pipeline.del(setKey);
    await pipeline.exec();
  }

  private buildRefreshTokenKey(refreshToken: string): string {
    return `${REFRESH_TOKEN_KEY_PREFIX}${refreshToken}`;
  }

  private buildUserRefreshTokensKey(userId: string): string {
    return `${USER_REFRESH_TOKENS_KEY_PREFIX}${userId}`;
  }
}
