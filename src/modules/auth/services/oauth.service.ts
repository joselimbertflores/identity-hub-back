import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { Repository } from 'typeorm';
import { compare } from 'bcrypt';
import Redis from 'ioredis';

import { LoginParamsDto, TokenRequestDto, AuthorizeParamsDto, LoginDto, GrantType } from '../dtos';
import { AuthException } from '../exceptions/auth.exception';
import { OAuthTokenErrorCode, OAuthTokenException } from '../exceptions/oauth-token.exception';
import { Application } from 'src/modules/access/entities';
import { AuthorizationCodePayload, PendingAuthorizationRequest, TokenClientAuthentication } from '../interfaces';
import { EnvironmentVariables } from 'src/config';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { PkceService } from './pkce.service';
import {
  AUTH_CODE_KEY_PREFIX,
  AUTH_CODE_TTL_SECONDS,
  IDENTITY_HUB_UI_PATHS,
  PENDING_AUTH_REQUEST_KEY_PREFIX,
  PENDING_AUTH_REQUEST_TTL_SECONDS,
} from '../constants/oauth.constants';

@Injectable()
export class OAuthService {
  constructor(
    @InjectRepository(Application) private readonly appRepository: Repository<Application>,
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService<EnvironmentVariables>,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly pkceService: PkceService,
  ) {}

  async handleAuthorizeRequest(params: AuthorizeParamsDto, sessionId: string | undefined): Promise<string> {
    const app = await this.appRepository.findOne({ where: { clientId: params.clientId, isActive: true } });
    if (!app) {
      return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.ERROR, {
        error: 'invalid_client',
      });
    }

    if (!app.redirectUris.includes(params.redirectUri)) {
      // Do not normalize or partially match callbacks; an unregistered redirect_uri is never a redirect target.
      return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.ERROR, {
        error: 'invalid_redirect_uri',
      });
    }

    const session = sessionId ? await this.authService.getAuthSession(sessionId) : null;
    if (!session) {
      const authRequestId = await this.createPendingAuthRequest(params);

      return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.LOGIN, {
        auth_request_id: authRequestId,
      });
    }

    const activeUser = await this.authService.findActiveUser(session.userId);
    if (activeUser?.mustChangePassword) {
      const authRequestId = await this.createPendingAuthRequest(params, sessionId);
      return this.buildPasswordChangeRedirectUrl(authRequestId);
    }

    const user = await this.authService.findUserEligibleForOAuthCredentials(session.userId, app.id);
    if (!user) {
      return this.buildClientRedirectUrl(params.redirectUri, {
        error: 'access_denied',
        state: params.state,
      });
    }

    const code = await this.createAuthorizationCode(user.id, params);

    return this.buildClientRedirectUrl(params.redirectUri, { code, state: params.state });
  }

  async authenticateAndCreateSession(dto: LoginDto): Promise<{ sessionId: string; mustChangePassword: boolean }> {
    const user = await this.authService.authenticateUser(dto);
    const sessionId = await this.authService.createAuthSession(user);
    return { sessionId, mustChangePassword: user.mustChangePassword };
  }

  async handleTokenRequest(
    dto: TokenRequestDto,
    authentication: TokenClientAuthentication = { method: 'none', clientId: dto.clientId },
  ) {
    if (authentication.clientId !== dto.clientId) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    const app = await this.loadValidApplication(authentication);
    return dto.grantType === GrantType.AUTHORIZATION_CODE
      ? this.handleAuthorizationCodeGrant(dto, app)
      : this.handleRefreshTokenGrant(dto, app);
  }

  async resolvePostLoginRedirect(
    { authRequestId }: LoginParamsDto,
    sessionId: string,
    mustChangePassword: boolean,
  ): Promise<string> {
    const boundAuthRequestId =
      authRequestId && (await this.bindPendingAuthRequestToSession(authRequestId, sessionId))
        ? authRequestId
        : undefined;

    if (mustChangePassword) {
      return this.buildPasswordChangeRedirectUrl(boundAuthRequestId);
    }

    return this.resumeAuthorizeFlow({ authRequestId: boundAuthRequestId }, sessionId);
  }

  async resumeAuthorizeFlow({ authRequestId }: LoginParamsDto, sessionId: string) {
    const homeUrl = this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.HOME);

    if (!authRequestId) return homeUrl;

    const pendingReq = await this.consumePendingAuthRequest(authRequestId, sessionId);
    if (!pendingReq) return homeUrl;

    const params = new URLSearchParams({
      client_id: pendingReq.clientId,
      redirect_uri: pendingReq.redirectUri,
      response_type: 'code',
      code_challenge: pendingReq.codeChallenge,
      code_challenge_method: pendingReq.codeChallengeMethod,
    });

    params.set('state', pendingReq.state);

    return `/oauth/authorize?${params.toString()}`;
  }

  buildLoginErrorRedirectUrl(error: AuthException, params: LoginParamsDto): string {
    return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.LOGIN, {
      error: error.code,
      auth_request_id: params.authRequestId,
    });
  }

  private async handleAuthorizationCodeGrant(dto: TokenRequestDto, app: Application) {
    const key = `${AUTH_CODE_KEY_PREFIX}${dto.code}`;

    const raw = await this.redis.get(key);

    if (!raw) throw new UnauthorizedException('Invalid or expired code.');

    const context = JSON.parse(raw) as AuthorizationCodePayload;

    if (context.clientId !== dto.clientId || context.redirectUri !== dto.redirectUri) {
      throw new UnauthorizedException('Invalid client.');
    }

    // PKCE is mandatory for authorization_code and only S256 challenges are accepted.
    this.pkceService.verifyCodeVerifier(dto.codeVerifier, context.codeChallenge, context.codeChallengeMethod);

    const user = await this.authService.findUserEligibleForOAuthCredentials(context.userId, app.id);
    if (!user) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    const preparedTokenPair = await this.tokenService.prepareTokenPair(
      {
        sub: user.id,
        externalKey: user.externalKey,
        name: user.fullName,
        clientId: context.clientId,
      },
      user.credentialVersion,
    );

    const completed = await this.tokenService.completeAuthorizationCodeGrant(dto.code!, raw, preparedTokenPair);
    if (!completed) {
      throw new UnauthorizedException('Invalid or expired code.');
    }

    return preparedTokenPair.tokens;
  }

  private async handleRefreshTokenGrant(dto: TokenRequestDto, app: Application) {
    if (!dto.refreshToken) {
      throw new UnauthorizedException('refresh_token is required.');
    }

    const storedRefreshToken = await this.tokenService.readRefreshToken(dto.refreshToken);
    if (!storedRefreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const data = storedRefreshToken.payload;

    if (data.clientId !== app.clientId) {
      throw new UnauthorizedException('invalid_client');
    }

    const user = await this.authService.findUserEligibleForOAuthCredentials(data.userId, app.id);
    if (!user) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    if (!Number.isInteger(data.credentialVersion) || data.credentialVersion !== user.credentialVersion) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const preparedTokenPair = await this.tokenService.prepareTokenPair(
      {
        sub: user.id,
        name: user.fullName,
        externalKey: user.externalKey,
        clientId: data.clientId,
      },
      user.credentialVersion,
    );

    const rotated = await this.tokenService.rotateRefreshToken(
      dto.refreshToken,
      storedRefreshToken.raw,
      preparedTokenPair,
    );
    if (!rotated) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    return preparedTokenPair.tokens;
  }

  private async createAuthorizationCode(
    userId: string,
    { clientId, redirectUri, codeChallenge, codeChallengeMethod }: AuthorizeParamsDto,
  ) {
    const code = crypto.randomUUID();
    const key = `${AUTH_CODE_KEY_PREFIX}${code}`;
    const payload: AuthorizationCodePayload = {
      userId,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      createdAt: Date.now(),
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', AUTH_CODE_TTL_SECONDS);
    return code;
  }

  private async loadValidApplication(authentication: TokenClientAuthentication): Promise<Application> {
    const app = await this.appRepository
      .createQueryBuilder('app')
      .addSelect('app.clientSecretHash')
      .where('app.clientId = :clientId', { clientId: authentication.clientId })
      .andWhere('app.isActive = true')
      .getOne();

    if (!app) throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);

    if (app.isConfidential) {
      if (authentication.method !== 'basic') {
        throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
      }
      const isSecretValid = await compare(authentication.clientSecret, app.clientSecretHash);
      if (!isSecretValid) {
        throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
      }
    } else if (authentication.method !== 'none') {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }
    return app;
  }

  private async createPendingAuthRequest(params: AuthorizeParamsDto, sessionId?: string): Promise<string> {
    const authRequestId = crypto.randomUUID();
    const key = `${PENDING_AUTH_REQUEST_KEY_PREFIX}${authRequestId}`;
    const payload: PendingAuthorizationRequest = { params, sessionId };
    await this.redis.set(key, JSON.stringify(payload), 'EX', PENDING_AUTH_REQUEST_TTL_SECONDS);
    return authRequestId;
  }

  private async bindPendingAuthRequestToSession(authRequestId: string, sessionId: string): Promise<boolean> {
    const key = `${PENDING_AUTH_REQUEST_KEY_PREFIX}${authRequestId}`;
    const data = await this.redis.get(key);
    if (!data) return false;

    const pendingRequest = this.parsePendingAuthRequest(data);
    if (pendingRequest.sessionId && pendingRequest.sessionId !== sessionId) return false;

    pendingRequest.sessionId = sessionId;
    const result = await this.redis.set(key, JSON.stringify(pendingRequest), 'KEEPTTL', 'XX');
    return result === 'OK';
  }

  private async consumePendingAuthRequest(
    authRequestId: string,
    sessionId: string,
  ): Promise<AuthorizeParamsDto | null> {
    const key = `${PENDING_AUTH_REQUEST_KEY_PREFIX}${authRequestId}`;
    const existingData = await this.redis.get(key);
    if (!existingData) return null;

    const existingRequest = this.parsePendingAuthRequest(existingData);
    if (existingRequest.sessionId !== sessionId) return null;

    // A pending OAuth request should resume at most once after login or password change.
    const consumedData = await this.redis.getdel(key);
    if (!consumedData) return null;

    const consumedRequest = this.parsePendingAuthRequest(consumedData);
    if (consumedRequest.sessionId !== sessionId) return null;
    return consumedRequest.params;
  }

  private parsePendingAuthRequest(data: string): PendingAuthorizationRequest {
    const parsed = JSON.parse(data) as PendingAuthorizationRequest | AuthorizeParamsDto;

    // Accept pending entries created immediately before this deployment, then store them in the current shape on bind.
    if ('params' in parsed) return parsed;
    return { params: parsed };
  }

  private buildPasswordChangeRedirectUrl(authRequestId?: string): string {
    const path = this.configService.getOrThrow<string>('IDENTITY_HUB_UI_CHANGE_PASSWORD_PATH');
    return this.buildIdentityHubUiUrl(path, { auth_request_id: authRequestId });
  }

  private buildIdentityHubUiUrl(path: string, params?: Record<string, string | undefined>): string {
    const baseUrl = this.configService.getOrThrow<string>('IDENTITY_HUB_UI_BASE_URL');
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private buildClientRedirectUrl(redirectUri: string, params?: Record<string, string | undefined>): string {
    const url = new URL(redirectUri);

    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }
}
