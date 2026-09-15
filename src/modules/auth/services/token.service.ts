import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { JwtService } from '@nestjs/jwt';

import Redis from 'ioredis';

import {
  AccessTokenPayload,
  AuthSessionPayload,
  AuthorizationCodePayload,
  isAuthSessionPayload,
  PreparedTokenPair,
  RefreshTokenPayload,
  StoredRefreshToken,
  TokenClientAuthentication,
} from '../interfaces';
import { AuthorizeParamsDto, GrantType, TokenRequestDto } from '../dtos';
import { OAuthTokenErrorCode, OAuthTokenException } from '../exceptions/oauth-token.exception';
import { Application } from 'src/modules/access/entities';
import { ApplicationClientAuthService } from 'src/modules/access/services';
import { UsersService } from 'src/modules/users/services';
import { PkceService } from './pkce.service';
import { buildSessionBySidKey, buildSessionClientsKey, SESSION_REDIS_KEY_PREFIX } from '../constants/session.constants';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_KEY_PREFIX,
  AUTH_CODE_TTL_SECONDS,
  LOGOUT_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_KEY_PREFIX,
  USER_REFRESH_TOKENS_KEY_PREFIX,
} from '../constants/oauth.constants';

// Both grants validate and persist against the same Redis snapshot as session revocation.
const VALIDATE_GRANT_SESSION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then
  return 0
end
local credential = cjson.decode(current)
local nextCredential = cjson.decode(ARGV[2])
if credential.sid ~= nextCredential.sid or credential.userId ~= nextCredential.userId
  or credential.credentialVersion ~= nextCredential.credentialVersion
  or credential.clientId ~= nextCredential.clientId then
  return 0
end
local sessionKey = redis.call('GET', KEYS[4])
if not sessionKey or string.sub(sessionKey, 1, ${SESSION_REDIS_KEY_PREFIX.length}) ~= '${SESSION_REDIS_KEY_PREFIX}' then
  return 0
end
local rawSession = redis.call('GET', sessionKey)
if not rawSession then return 0 end
local ok, session = pcall(cjson.decode, rawSession)
if not ok or type(session) ~= 'table' or session.sid ~= credential.sid
  or session.userId ~= credential.userId
  or session.credentialVersion ~= credential.credentialVersion then
  return 0
end
local ttl = math.min(redis.call('PTTL', sessionKey), redis.call('PTTL', KEYS[4]))
if ttl <= 0 then return 0 end
local expiresAt = math.min(redis.call('PEXPIRETIME', sessionKey), redis.call('PEXPIRETIME', KEYS[4]))
`;

const COMPLETE_AUTHORIZATION_CODE_GRANT_SCRIPT = `
${VALIDATE_GRANT_SESSION_SCRIPT}
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], ARGV[2], 'PXAT', expiresAt)
redis.call('SADD', KEYS[3], ARGV[3])
-- A shorter session must not shorten the index used by another session of this user.
if redis.call('PEXPIRETIME', KEYS[3]) < expiresAt then
  redis.call('PEXPIREAT', KEYS[3], expiresAt)
end
redis.call('SADD', KEYS[5], credential.clientId)
redis.call('PEXPIREAT', KEYS[5], expiresAt)
return ttl
`;

const ROTATE_REFRESH_TOKEN_SCRIPT = `
${VALIDATE_GRANT_SESSION_SCRIPT}
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], ARGV[2], 'PXAT', expiresAt)
redis.call('SREM', KEYS[3], ARGV[3])
redis.call('SADD', KEYS[3], ARGV[4])
if redis.call('PEXPIRETIME', KEYS[3]) < expiresAt then
  redis.call('PEXPIREAT', KEYS[3], expiresAt)
end
return ttl
`;

const REVOKE_USER_REFRESH_TOKENS_SCRIPT = `
local tokens = redis.call('SMEMBERS', KEYS[1])
for _, token in ipairs(tokens) do
  redis.call('DEL', ARGV[1] .. token)
end
redis.call('DEL', KEYS[1])
return #tokens
`;

@Injectable()
export class TokenService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly clientAuthService: ApplicationClientAuthService,
    private readonly pkceService: PkceService,
  ) {}

  async handleTokenRequest(dto: TokenRequestDto, authentication: TokenClientAuthentication) {
    if (authentication.clientId !== dto.clientId) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    let app: Application;
    try {
      app = await this.clientAuthService.authenticateOAuthClient(authentication);
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
      throw error;
    }
    return dto.grantType === GrantType.AUTHORIZATION_CODE
      ? this.handleAuthorizationCodeGrant(dto, app)
      : this.handleRefreshTokenGrant(dto, app);
  }

  private async handleAuthorizationCodeGrant(dto: TokenRequestDto, app: Application) {
    const key = `${AUTH_CODE_KEY_PREFIX}${dto.code}`;

    const raw = await this.redis.get(key);

    if (!raw) throw new UnauthorizedException('Invalid or expired code.');

    const context = this.parseCredential(raw) as AuthorizationCodePayload | null;
    if (
      !context ||
      typeof context.redirectUri !== 'string' ||
      typeof context.codeChallenge !== 'string' ||
      context.codeChallengeMethod !== 'S256' ||
      !Number.isFinite(context.createdAt)
    ) {
      throw new UnauthorizedException('Invalid or expired code.');
    }

    if (context.clientId !== dto.clientId || context.redirectUri !== dto.redirectUri) {
      throw new UnauthorizedException('Invalid client.');
    }

    // PKCE is mandatory for authorization_code and only S256 challenges are accepted.
    this.pkceService.verifyCodeVerifier(dto.codeVerifier, context.codeChallenge, context.codeChallengeMethod);

    const user = await this.usersService.findUserEligibleForOAuthCredentials(context.userId, app.id);
    if (!user || !Number.isInteger(context.credentialVersion) || user.credentialVersion !== context.credentialVersion) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    const preparedTokenPair = await this.prepareTokenPair(
      {
        sub: user.id,
        externalKey: user.externalKey,
        name: user.fullName,
        clientId: context.clientId,
        sid: context.sid,
      },
      user.credentialVersion,
    );

    const completed = await this.completeAuthorizationCodeGrant(dto.code!, raw, preparedTokenPair);
    if (completed <= 0) {
      throw new UnauthorizedException('Invalid or expired code.');
    }

    return { ...preparedTokenPair.tokens, refreshTokenExpiresIn: Math.floor(completed / 1000) };
  }

  private async handleRefreshTokenGrant(dto: TokenRequestDto, app: Application) {
    if (!dto.refreshToken) {
      throw new UnauthorizedException('refresh_token is required.');
    }

    const storedRefreshToken = await this.readRefreshToken(dto.refreshToken);
    if (!storedRefreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const data = storedRefreshToken.payload;

    if (data.clientId !== app.clientId) {
      throw new UnauthorizedException('invalid_client');
    }

    const user = await this.usersService.findUserEligibleForOAuthCredentials(data.userId, app.id);
    if (!user) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    if (!Number.isInteger(data.credentialVersion) || data.credentialVersion !== user.credentialVersion) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const preparedTokenPair = await this.prepareTokenPair(
      {
        sub: user.id,
        name: user.fullName,
        externalKey: user.externalKey,
        clientId: data.clientId,
        sid: data.sid,
      },
      user.credentialVersion,
    );

    const rotated = await this.rotateRefreshToken(dto.refreshToken, storedRefreshToken.raw, preparedTokenPair);
    if (rotated <= 0) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    return { ...preparedTokenPair.tokens, refreshTokenExpiresIn: Math.floor(rotated / 1000) };
  }

  async createAuthorizationCode(
    { userId, credentialVersion, sid }: AuthSessionPayload,
    { clientId, redirectUri, codeChallenge, codeChallengeMethod }: AuthorizeParamsDto,
  ) {
    const code = crypto.randomUUID();
    const key = `${AUTH_CODE_KEY_PREFIX}${code}`;
    const payload: AuthorizationCodePayload = {
      userId,
      credentialVersion,
      sid,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      createdAt: Date.now(),
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', AUTH_CODE_TTL_SECONDS);
    return code;
  }

  createLogoutToken(sid: string, clientId: string): Promise<string> {
    return this.jwtService.signAsync(
      {
        sid,
        events: {
          'http://schemas.openid.net/event/backchannel-logout': {},
        },
      },
      {
        audience: clientId,
        expiresIn: LOGOUT_TOKEN_TTL_SECONDS,
        jwtid: crypto.randomUUID(),
        header: { alg: 'RS256', typ: 'logout+jwt' },
      },
    );
  }

  private async prepareTokenPair(payload: AccessTokenPayload, credentialVersion: number): Promise<PreparedTokenPair> {
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
        tokenType: 'Bearer',
      },
      refreshTokenPayload: {
        userId: payload.sub,
        sid: payload.sid,
        clientId: payload.clientId,
        credentialVersion,
        scope: payload.scope,
      },
    };
  }

  private async completeAuthorizationCodeGrant(
    authorizationCode: string,
    expectedAuthorizationCodePayload: string,
    preparedTokenPair: PreparedTokenPair,
  ): Promise<number> {
    const { tokens, refreshTokenPayload } = preparedTokenPair;
    const result = await this.redis.eval(
      COMPLETE_AUTHORIZATION_CODE_GRANT_SCRIPT,
      5,
      `${AUTH_CODE_KEY_PREFIX}${authorizationCode}`,
      this.buildRefreshTokenKey(tokens.refreshToken),
      this.buildUserRefreshTokensKey(refreshTokenPayload.userId),
      buildSessionBySidKey(refreshTokenPayload.sid),
      buildSessionClientsKey(refreshTokenPayload.sid),
      expectedAuthorizationCodePayload,
      JSON.stringify(refreshTokenPayload),
      tokens.refreshToken,
    );

    return Number(result);
  }

  private async readRefreshToken(refreshToken: string): Promise<StoredRefreshToken | null> {
    const raw = await this.redis.get(this.buildRefreshTokenKey(refreshToken));
    if (!raw) return null;

    const payload = this.parseCredential(raw);
    return payload ? { raw, payload } : null;
  }

  private async rotateRefreshToken(
    refreshToken: string,
    expectedRefreshTokenPayload: string,
    preparedTokenPair: PreparedTokenPair,
  ): Promise<number> {
    const { tokens, refreshTokenPayload } = preparedTokenPair;
    const result = await this.redis.eval(
      ROTATE_REFRESH_TOKEN_SCRIPT,
      4,
      this.buildRefreshTokenKey(refreshToken),
      this.buildRefreshTokenKey(tokens.refreshToken),
      this.buildUserRefreshTokensKey(refreshTokenPayload.userId),
      buildSessionBySidKey(refreshTokenPayload.sid),
      expectedRefreshTokenPayload,
      JSON.stringify(refreshTokenPayload),
      refreshToken,
      tokens.refreshToken,
    );

    return Number(result);
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.redis.eval(
      REVOKE_USER_REFRESH_TOKENS_SCRIPT,
      1,
      this.buildUserRefreshTokensKey(userId),
      REFRESH_TOKEN_KEY_PREFIX,
    );
  }

  private parseCredential(raw: string): RefreshTokenPayload | null {
    try {
      const value: unknown = JSON.parse(raw);
      if (!isAuthSessionPayload(value)) return null;
      const payload = value as RefreshTokenPayload;
      return typeof payload.clientId === 'string' && payload.clientId.length > 0 ? payload : null;
    } catch {
      return null;
    }
  }

  private buildRefreshTokenKey(refreshToken: string): string {
    return `${REFRESH_TOKEN_KEY_PREFIX}${refreshToken}`;
  }

  private buildUserRefreshTokensKey(userId: string): string {
    return `${USER_REFRESH_TOKENS_KEY_PREFIX}${userId}`;
  }
}
