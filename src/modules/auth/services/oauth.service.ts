import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { In, Repository } from 'typeorm';
import Redis from 'ioredis';

import { LoginParamsDto, AuthorizeParamsDto, LogoutParamsDto } from '../dtos';
import { AuthException } from '../exceptions/auth.exception';
import { Application } from 'src/modules/access/entities';
import { PendingAuthorizationRequest } from '../interfaces';
import { EnvironmentVariables } from 'src/config';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { UsersService } from 'src/modules/users/services';
import {
  BACKCHANNEL_LOGOUT_TIMEOUT_MS,
  IDENTITY_HUB_UI_PATHS,
  PENDING_AUTH_REQUEST_KEY_PREFIX,
  PENDING_AUTH_REQUEST_TTL_SECONDS,
} from '../constants/oauth.constants';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

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
    if (sessionUser.mustChangePassword) {
      const authRequestId = await this.createPendingAuthRequest(params, sessionId);
      return this.buildPasswordChangeRedirectUrl(authRequestId);
    }

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

  async handleLogoutRequest(params: LogoutParamsDto, sessionId: string | undefined): Promise<string> {
    const app = await this.appRepository.findOne({ where: { clientId: params.clientId, isActive: true } });
    if (!app || app.postLogoutRedirectUri !== params.postLogoutRedirectUri) {
      throw new BadRequestException('Invalid logout request');
    }

    await this.logout(sessionId);
    return app.postLogoutRedirectUri;
  }

  async logout(sessionId: string | undefined) {
    const revokedSession = await this.authService.logout(sessionId);
    if (revokedSession) {
      await this.notifyBackchannelLogout(revokedSession.sid, revokedSession.clientIds);
    }

    return {
      ok: true,
      message: revokedSession ? 'Logout successful' : 'Session is already logged out',
    };
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

  private async notifyBackchannelLogout(sid: string, clientIds: string[]): Promise<void> {
    if (clientIds.length === 0) return;

    let applications: Application[];
    try {
      applications = await this.appRepository.find({ where: { clientId: In([...new Set(clientIds)]) } });
    } catch {
      this.logger.warn('Could not load applications for back-channel logout');
      return;
    }

    await Promise.all(applications.map((app) => this.sendBackchannelLogout(app, sid)));
  }

  private async sendBackchannelLogout(app: Application, sid: string): Promise<void> {
    if (!app.backchannelLogoutUri) return;

    try {
      const logoutToken = await this.tokenService.createLogoutToken(sid, app.clientId);
      const response = await fetch(app.backchannelLogoutUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: logoutToken }),
        signal: AbortSignal.timeout(BACKCHANNEL_LOGOUT_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(`Back-channel logout failed for client ${app.clientId} with status ${response.status}`);
      }
    } catch {
      this.logger.warn(`Back-channel logout failed for client ${app.clientId}`);
    }
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
    const parsed = JSON.parse(data) as PendingAuthorizationRequest;
    if (!parsed || typeof parsed !== 'object' || !parsed.params) {
      throw new Error('Invalid pending authorization request');
    }
    return parsed;
  }

  private buildPasswordChangeRedirectUrl(authRequestId?: string): string {
    return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.CHANGE_PASSWORD, { auth_request_id: authRequestId });
  }

  private buildIdentityHubUiUrl(path: string, params?: Record<string, string | undefined>): string {
    const baseUrl = this.configService.getOrThrow('IDENTITY_HUB_UI_URL', { infer: true });
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
