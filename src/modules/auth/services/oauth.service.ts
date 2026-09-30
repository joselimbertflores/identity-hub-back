import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { Repository } from 'typeorm';
import Redis from 'ioredis';

import { LoginParamsDto, AuthorizeParamsDto } from '../dtos';
import { AuthException } from '../exceptions/auth.exception';
import { Application } from 'src/modules/access/entities';
import { PendingAuthorizationRequest } from '../interfaces';
import { EnvironmentVariables, getIdentityHubFrontendUrl } from 'src/config';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { UsersService } from 'src/modules/users/services';
import {
  IDENTITY_HUB_UI_PATHS,
  PENDING_AUTH_REQUEST_KEY_PREFIX,
  PENDING_AUTH_REQUEST_TTL_SECONDS,
} from '../constants/oauth.constants';

@Injectable()
export class OAuthService {
  constructor(
    @InjectRepository(Application) private readonly appRepository: Repository<Application>,
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
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

    const authenticatedSession = sessionId ? await this.authService.getValidatedSession(sessionId) : null;
    if (!authenticatedSession) {
      const authRequestId = await this.createPendingAuthRequest(params);

      return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.LOGIN, {
        auth_request_id: authRequestId,
      });
    }

    const { session, user: sessionUser } = authenticatedSession;

    const user = await this.usersService.findUserEligibleForOAuthCredentials(sessionUser.id, app.id);
    if (!user || user.credentialVersion !== session.credentialVersion) {
      return this.buildClientRedirectUrl(params.redirectUri, {
        error: 'access_denied',
        state: params.state,
      });
    }

    const code = await this.tokenService.createAuthorizationCode(session, params);

    return this.buildClientRedirectUrl(params.redirectUri, { code, state: params.state });
  }

  async resolvePostLoginRedirect(
    { authRequestId }: LoginParamsDto,
    sessionId: string,
  ): Promise<string> {
    const boundAuthRequestId =
      authRequestId && (await this.bindPendingAuthRequestToSession(authRequestId, sessionId))
        ? authRequestId
        : undefined;

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
      scope: pendingReq.scope,
      nonce: pendingReq.nonce,
      state: pendingReq.state,
      code_challenge: pendingReq.codeChallenge,
      code_challenge_method: pendingReq.codeChallengeMethod,
    });

    return `/oauth/authorize?${params.toString()}`;
  }

  buildLoginErrorRedirectUrl(error: AuthException, params: LoginParamsDto): string {
    return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.LOGIN, {
      error: error.code,
      auth_request_id: params.authRequestId,
    });
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

    // A pending OIDC request should resume at most once after login or password change.
    const consumedData = await this.redis.getdel(key);
    if (!consumedData) return null;

    const consumedRequest = this.parsePendingAuthRequest(consumedData);
    if (consumedRequest.sessionId !== sessionId) return null;
    return consumedRequest.params;
  }

  private parsePendingAuthRequest(data: string): PendingAuthorizationRequest {
    const parsed = JSON.parse(data) as PendingAuthorizationRequest;
    if (!parsed || typeof parsed !== 'object' || !parsed.params) {
      throw new Error('Invalid pending authorization request');
    }
    return parsed;
  }

  private buildIdentityHubUiUrl(path: string, params?: Record<string, string | undefined>): string {
    const baseUrl = getIdentityHubFrontendUrl(this.configService);
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
