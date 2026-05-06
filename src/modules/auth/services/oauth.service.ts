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

const AUTH_CODE_KEY_PREFIX = 'auth_code:';
const PENDING_AUTH_REQUEST_KEY_PREFIX = 'pending_oauth:';
const AUTH_CODE_TTL_SECONDS = 5 * 60;
const PENDING_AUTH_REQUEST_TTL_SECONDS = 5 * 60;

@Injectable()
export class OAuthService {
  constructor(
    @InjectRepository(Application) private appRepository: Repository<Application>,
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRedis() private redis: Redis,
    private configService: ConfigService<EnvironmentVariables>,
    private tokenService: TokenService,
    private authService: AuthService,
  ) {}

  async handleAuthorizeRequest(params: AuthorizeParamsDto, sessionId: string | undefined) {
    const app = await this.appRepository.findOne({ where: { clientId: params.clientId, isActive: true } });
    if (!app) {
      // We cannot redirect to a client callback until client_id is validated.
      return this.resolveIdentityHubErrorRedirect('invalid_client');
    }

    if (!app.redirectUris.includes(params.redirectUri)) {
      // Never redirect to an unregistered redirect_uri.
      return this.resolveIdentityHubErrorRedirect('invalid_redirect_uri');
    }

    const session = sessionId ? await this.authService.getAuthSession(sessionId) : null;
    if (!session) {
      const authRequestId = await this.createPendingAuthRequest(params);
      const loginUrl = new URL(this.configService.getOrThrow('IDENTITY_HUB_LOGIN_PATH'));
      loginUrl.searchParams.set('auth_request_id', authRequestId);
      return loginUrl.toString();
    }

    const hasAccess = await this.authService.checkUserAppAccess(session.userId, app.id);
    if (!hasAccess) {
      const url = new URL(params.redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (params.state) url.searchParams.set('state', params.state);
      return url.toString();
    }

    const code = await this.createAuthCode(session.userId, params);
    const resultUrl = new URL(params.redirectUri);
    resultUrl.searchParams.set('code', code);
    if (params.state) {
      resultUrl.searchParams.set('state', params.state);
    }
    return resultUrl.toString();
  }

  async handleLoginRequest(dto: LoginDto) {
    const user = await this.authService.authenticateUser(dto);
    return await this.authService.createAuthSession(user);
  }

  async handleTokenRequest(dto: TokenRequestDto) {
    const app = await this.loadValidApplication(dto.clientId, dto.clientSecret);
    return dto.grantType === GrantType.AUTHORIZATION_CODE
      ? this.handleAuthorizationCodeGrant(dto, app)
      : this.handleRefreshTokenGrant(dto, app);
  }

  async resumeAuthorizeFlow({ authRequestId }: LoginParamsDto) {
    const homeUrl = this.configService.getOrThrow<string>('IDENTITY_HUB_HOME_PATH');
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

  resolveLoginErrorRedirect(error: AuthException, params: LoginParamsDto) {
    const { authRequestId } = params;
    const url = new URL(this.getAuthErrorRedirectBaseUrl());
    url.searchParams.set('error', error.code);
    if (authRequestId) {
      url.searchParams.set('auth_request_id', authRequestId);
    }
    return url.toString();
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

    const user = await this.checkValidUser(context.userId);
    return await this.tokenService.generateTokenPair({
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

    const user = await this.checkValidUser(data.userId);

    const hasAccess = await this.authService.checkUserAppAccess(data.userId, app.id);

    if (!hasAccess) {
      throw new UnauthorizedException('User no longer has access to this application.');
    }

    return await this.tokenService.generateTokenPair({
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
    // One-time short TTL prevents replay attacks.
    await this.redis.set(key, JSON.stringify(payload), 'EX', AUTH_CODE_TTL_SECONDS);
    return code;
  }

  private async checkValidUser(id: string) {
    const user = await this.userRepository.findOne({ where: { id, isActive: true } });

    if (!user) {
      await this.tokenService.revokeAllForUser(id);
      throw new UnauthorizedException('User not authorized.');
    }
    return user;
  }

  private async loadValidApplication(clientId: string, clientSecret?: string) {
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

  private resolveIdentityHubErrorRedirect(errorCode: string) {
    const url = new URL(this.getAuthErrorRedirectBaseUrl());
    url.searchParams.set('error', errorCode);
    return url.toString();
  }

  private getAuthErrorRedirectBaseUrl() {
    return this.configService.get<string>('AUTH_ERROR_REDIRECT') ?? this.configService.getOrThrow<string>('IDENTITY_HUB_LOGIN_PATH');
  }

  private async createPendingAuthRequest(params: AuthorizeParamsDto) {
    const authRequestId = crypto.randomUUID();
    const key = `${PENDING_AUTH_REQUEST_KEY_PREFIX}${authRequestId}`;
    await this.redis.set(key, JSON.stringify(params), 'EX', PENDING_AUTH_REQUEST_TTL_SECONDS);
    return authRequestId;
  }

  private async consumePendingAuthRequest(authRequestId: string) {
    const key = `${PENDING_AUTH_REQUEST_KEY_PREFIX}${authRequestId}`;
    const data = await this.redis.getdel(key);
    if (!data) return null;
    return JSON.parse(data) as AuthorizeParamsDto;
  }
}
