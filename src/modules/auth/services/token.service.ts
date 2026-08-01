import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { JwtService } from '@nestjs/jwt';

import Redis from 'ioredis';

import { AccessTokenPayload, PreparedTokenPair, StoredRefreshToken } from '../interfaces';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_KEY_PREFIX,
  REFRESH_TOKEN_KEY_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  USER_REFRESH_TOKENS_KEY_PREFIX,
} from '../constants/oauth.constants';

const COMPLETE_AUTHORIZATION_CODE_GRANT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then
  return 0
end

redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('SADD', KEYS[3], ARGV[4])
redis.call('EXPIRE', KEYS[3], ARGV[3])
return 1
`;

const ROTATE_REFRESH_TOKEN_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then
  return 0
end

redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('SREM', KEYS[3], ARGV[4])
redis.call('SADD', KEYS[3], ARGV[5])
redis.call('EXPIRE', KEYS[3], ARGV[3])
return 1
`;

@Injectable()
export class TokenService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private jwtService: JwtService,
  ) {}

  async prepareTokenPair(payload: AccessTokenPayload): Promise<PreparedTokenPair> {
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      audience: payload.clientId,
    });

    const refreshToken = crypto.randomUUID();

    return {
      tokens: {
        accessToken,
        refreshToken,
        accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
        tokenType: 'Bearer',
      },
      refreshTokenPayload: {
        userId: payload.sub,
        clientId: payload.clientId,
        scope: payload.scope,
      },
    };
  }

  async completeAuthorizationCodeGrant(
    authorizationCode: string,
    expectedAuthorizationCodePayload: string,
    preparedTokenPair: PreparedTokenPair,
  ): Promise<boolean> {
    const { tokens, refreshTokenPayload } = preparedTokenPair;
    const result = await this.redis.eval(
      COMPLETE_AUTHORIZATION_CODE_GRANT_SCRIPT,
      3,
      `${AUTH_CODE_KEY_PREFIX}${authorizationCode}`,
      this.buildRefreshTokenKey(tokens.refreshToken),
      this.buildUserRefreshTokensKey(refreshTokenPayload.userId),
      expectedAuthorizationCodePayload,
      JSON.stringify(refreshTokenPayload),
      REFRESH_TOKEN_TTL_SECONDS,
      tokens.refreshToken,
    );

    return result === 1;
  }

  async readRefreshToken(refreshToken: string): Promise<StoredRefreshToken | null> {
    const raw = await this.redis.get(this.buildRefreshTokenKey(refreshToken));
    if (!raw) return null;

    return {
      raw,
      payload: JSON.parse(raw) as StoredRefreshToken['payload'],
    };
  }

  async rotateRefreshToken(
    refreshToken: string,
    expectedRefreshTokenPayload: string,
    preparedTokenPair: PreparedTokenPair,
  ): Promise<boolean> {
    const { tokens, refreshTokenPayload } = preparedTokenPair;
    const result = await this.redis.eval(
      ROTATE_REFRESH_TOKEN_SCRIPT,
      3,
      this.buildRefreshTokenKey(refreshToken),
      this.buildRefreshTokenKey(tokens.refreshToken),
      this.buildUserRefreshTokensKey(refreshTokenPayload.userId),
      expectedRefreshTokenPayload,
      JSON.stringify(refreshTokenPayload),
      REFRESH_TOKEN_TTL_SECONDS,
      refreshToken,
      tokens.refreshToken,
    );

    return result === 1;
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
