import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { JwtService } from '@nestjs/jwt';

import Redis from 'ioredis';

import {
  AccessTokenPayload,
  AuthSessionPayload,
  AuthorizationCodePayload,
  IdTokenPayload,
  isAuthorizationCodePayload,
  IssuedTokens,
  TokenClientAuthentication,
} from '../interfaces';
import { AuthorizeParamsDto, TokenRequestDto } from '../dtos';
import { OAuthTokenErrorCode, OAuthTokenException } from '../exceptions/oauth-token.exception';
import { Application } from 'src/modules/access/entities';
import { ApplicationClientAuthService } from 'src/modules/access/services';
import { UsersService } from 'src/modules/users/services';
import { PkceService } from './pkce.service';
import { buildSessionBySidKey, buildSessionClientsKey, SESSION_REDIS_KEY_PREFIX } from '../constants/session.constants';
import {
  TOKEN_TTL_SECONDS,
  AUTH_CODE_KEY_PREFIX,
  AUTH_CODE_TTL_SECONDS,
  LOGOUT_TOKEN_TTL_SECONDS,
} from '../constants/oauth.constants';

const COMPLETE_AUTHORIZATION_CODE_GRANT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then
  return 0
end
local credential = cjson.decode(current)
local sessionKey = redis.call('GET', KEYS[2])
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
local ttl = math.min(redis.call('PTTL', sessionKey), redis.call('PTTL', KEYS[2]))
if ttl <= 0 then return 0 end
local expiresAt = math.min(redis.call('PEXPIRETIME', sessionKey), redis.call('PEXPIRETIME', KEYS[2]))
redis.call('DEL', KEYS[1])
redis.call('SADD', KEYS[3], credential.clientId)
redis.call('PEXPIREAT', KEYS[3], expiresAt)
return 1
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

  async handleTokenRequest(dto: TokenRequestDto, authentication: TokenClientAuthentication): Promise<IssuedTokens> {
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

    return this.handleAuthorizationCodeGrant(dto, app);
  }

  private async handleAuthorizationCodeGrant(dto: TokenRequestDto, app: Application): Promise<IssuedTokens> {
    const key = `${AUTH_CODE_KEY_PREFIX}${dto.code}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException('Invalid or expired code.');

    const context = this.parseAuthorizationCode(raw);
    if (!context) {
      throw new UnauthorizedException('Invalid or expired code.');
    }

    if (context.clientId !== dto.clientId || context.redirectUri !== dto.redirectUri) {
      throw new UnauthorizedException('Invalid client.');
    }

    this.pkceService.verifyCodeVerifier(dto.codeVerifier, context.codeChallenge, context.codeChallengeMethod);

    const user = await this.usersService.findUserEligibleForOAuthCredentials(context.userId, app.id);
    if (!user || user.credentialVersion !== context.credentialVersion) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    const tokens = await this.issueTokens(
      {
        sub: user.id,
        externalKey: user.externalKey,
        name: user.fullName,
        clientId: context.clientId,
        sid: context.sid,
        scope: context.scope,
      },
      {
        sub: user.id,
        externalKey: user.externalKey,
        name: user.fullName,
        sid: context.sid,
        nonce: context.nonce,
      },
    );

    const completed = await this.completeAuthorizationCodeGrant(dto.code, raw, context);
    if (!completed) {
      throw new UnauthorizedException('Invalid or expired code.');
    }

    return tokens;
  }

  async createAuthorizationCode(
    { userId, credentialVersion, sid }: AuthSessionPayload,
    { clientId, redirectUri, scope, nonce, codeChallenge, codeChallengeMethod }: AuthorizeParamsDto,
  ): Promise<string> {
    const code = crypto.randomUUID();
    const key = `${AUTH_CODE_KEY_PREFIX}${code}`;
    const payload: AuthorizationCodePayload = {
      userId,
      credentialVersion,
      sid,
      clientId,
      redirectUri,
      scope,
      nonce,
      codeChallenge,
      codeChallengeMethod,
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

  private async issueTokens(accessPayload: AccessTokenPayload, idPayload: IdTokenPayload): Promise<IssuedTokens> {
    const [accessToken, idToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        expiresIn: TOKEN_TTL_SECONDS,
        audience: accessPayload.clientId,
      }),
      this.jwtService.signAsync(idPayload, {
        expiresIn: TOKEN_TTL_SECONDS,
        audience: accessPayload.clientId,
        header: { alg: 'RS256', typ: 'JWT' },
      }),
    ]);

    return {
      accessToken,
      idToken,
      accessTokenExpiresIn: TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
    };
  }

  private async completeAuthorizationCodeGrant(
    authorizationCode: string,
    expectedAuthorizationCodePayload: string,
    context: AuthorizationCodePayload,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      COMPLETE_AUTHORIZATION_CODE_GRANT_SCRIPT,
      3,
      `${AUTH_CODE_KEY_PREFIX}${authorizationCode}`,
      buildSessionBySidKey(context.sid),
      buildSessionClientsKey(context.sid),
      expectedAuthorizationCodePayload,
    );

    return Number(result) === 1;
  }

  private parseAuthorizationCode(raw: string): AuthorizationCodePayload | null {
    try {
      const value: unknown = JSON.parse(raw);
      return isAuthorizationCodePayload(value) ? value : null;
    } catch {
      return null;
    }
  }
}
