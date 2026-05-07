import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

import { Repository } from 'typeorm';
import { compare } from 'bcrypt';
import Redis from 'ioredis';

import { LoginParamsDto, TokenRequestDto, AuthorizeParamsDto, LoginDto, GrantType } from '../dtos';
import { AuthException } from '../exceptions/auth.exception';
import { Application } from 'src/modules/access/entities';
import { User } from 'src/modules/users/entities';
import { AuthorizationCodePayload } from '../interfaces';
import { EnvironmentVariables } from 'src/config';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
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
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService<EnvironmentVariables>,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
  ) {}

  async handleAuthorizeRequest(params: AuthorizeParamsDto, sessionId: string | undefined): Promise<string> {
    const app = await this.appRepository.findOne({ where: { clientId: params.clientId, isActive: true } });
    if (!app) {
      return this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.ERROR, {
        error: 'invalid_client',
      });
    }

    if (!app.redirectUris.includes(params.redirectUri)) {
      // Never redirect to an unregistered redirect_uri.
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

    const hasAccess = await this.authService.checkUserAppAccess(session.userId, app.id);
    if (!hasAccess) {
      return this.buildClientRedirectUrl(params.redirectUri, {
        error: 'access_denied',
        state: params.state,
      });
    }

    const code = await this.createAuthCode(session.userId, params);

    return this.buildClientRedirectUrl(params.redirectUri, { code, state: params.state });
  }

  async authenticateAndCreateSession(dto: LoginDto): Promise<string> {
    const user = await this.authService.authenticateUser(dto);
    return this.authService.createAuthSession(user);
  }

  async handleTokenRequest(dto: TokenRequestDto) {
    const app = await this.loadValidApplication(dto.clientId, dto.clientSecret);
    return dto.grantType === GrantType.AUTHORIZATION_CODE
      ? this.handleAuthorizationCodeGrant(dto, app)
      : this.handleRefreshTokenGrant(dto, app);
  }

  async resumeAuthorizeFlow({ authRequestId }: LoginParamsDto) {
    const homeUrl = this.buildIdentityHubUiUrl(IDENTITY_HUB_UI_PATHS.HOME);

    if (!authRequestId) return homeUrl;

    const pendingReq = await this.consumePendingAuthRequest(authRequestId);
    if (!pendingReq) return homeUrl;

    const params = new URLSearchParams({
      client_id: pendingReq.clientId,
      redirect_uri: pendingReq.redirectUri,
      response_type: 'code',
    });

    if (pendingReq.scope) {
      params.set('scope', pendingReq.scope);
    }

    if (pendingReq.state) {
      params.set('state', pendingReq.state);
    }

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

    const raw = await this.redis.getdel(key);

    if (!raw) throw new UnauthorizedException('Invalid or expired code.');

    const context = JSON.parse(raw) as AuthorizationCodePayload;

    if (context.clientId !== dto.clientId || context.redirectUri !== dto.redirectUri) {
      throw new UnauthorizedException('Invalid client.');
    }

    const hasAccess = await this.authService.checkUserAppAccess(context.userId, app.id);
    if (!hasAccess) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    const user = await this.loadActiveUserOrRevokeTokens(context.userId);
    return this.tokenService.generateTokenPair({
      sub: user.id,
      externalKey: user.externalKey,
      name: user.fullName,
      clientId: context.clientId,
      scope: context.scope,
    });
  }

  private async handleRefreshTokenGrant(dto: TokenRequestDto, app: Application) {
    const data = await this.tokenService.consumeRefreshToken(dto.refreshToken);

    if (data.clientId !== app.clientId) {
      throw new UnauthorizedException('invalid_client');
    }

    const user = await this.loadActiveUserOrRevokeTokens(data.userId);

    const hasAccess = await this.authService.checkUserAppAccess(data.userId, app.id);

    if (!hasAccess) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    return this.tokenService.generateTokenPair({
      sub: user.id,
      name: user.fullName,
      externalKey: user.externalKey,
      clientId: data.clientId,
      scope: data.scope,
    });
  }

  private async createAuthCode(userId: string, { clientId, redirectUri, scope }: AuthorizeParamsDto) {
    const code = crypto.randomUUID();
    const key = `${AUTH_CODE_KEY_PREFIX}${code}`;
    const payload: AuthorizationCodePayload = {
      userId,
      clientId,
      redirectUri,
      scope,
      createdAt: Date.now(),
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', AUTH_CODE_TTL_SECONDS);
    return code;
  }

  private async loadActiveUserOrRevokeTokens(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id, isActive: true } });

    if (!user) {
      await this.tokenService.revokeAllForUser(id);
      throw new UnauthorizedException('User not authorized.');
    }
    return user;
  }

  private async loadValidApplication(clientId: string, clientSecret?: string): Promise<Application> {
    const app = await this.appRepository
      .createQueryBuilder('app')
      .addSelect('app.clientSecretHash')
      .where('app.clientId = :clientId', { clientId })
      .andWhere('app.isActive = true')
      .getOne();

    if (!app) throw new UnauthorizedException('Invalid client id.');

    if (app.isConfidential) {
      if (!clientSecret) throw new UnauthorizedException('Client secret is required.');
      const isSecretValid = await compare(clientSecret, app.clientSecretHash);
      if (!isSecretValid) {
        throw new UnauthorizedException('Invalid client secret.');
      }
    }
    return app;
  }

  private async createPendingAuthRequest(params: AuthorizeParamsDto): Promise<string> {
    const authRequestId = crypto.randomUUID();
    const key = `${PENDING_AUTH_REQUEST_KEY_PREFIX}${authRequestId}`;
    await this.redis.set(key, JSON.stringify(params), 'EX', PENDING_AUTH_REQUEST_TTL_SECONDS);
    return authRequestId;
  }

  private async consumePendingAuthRequest(authRequestId: string): Promise<AuthorizeParamsDto | null> {
    const key = `${PENDING_AUTH_REQUEST_KEY_PREFIX}${authRequestId}`;
    const data = await this.redis.getdel(key);
    if (!data) return null;
    return JSON.parse(data) as AuthorizeParamsDto;
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
