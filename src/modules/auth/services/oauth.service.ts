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

  async handleAuthorizeRequest(params: AuthorizeParamsDto, sessionId?: string) {
    const app = await this.appRepository.findOne({ where: { clientId: params.clientId, isActive: true } });
    if (!app) throw new UnauthorizedException('Invalid client.');
    if (!app.redirectUris.includes(params.redirectUri)) throw new UnauthorizedException('Invalid redirect uri.');

    const session = sessionId ? await this.authService.getAuthSession(sessionId) : null;
    if (!session) {
      const oAuthRequestId = await this.createPendingOAuthRequest(params);
      const loginUrl = new URL(this.configService.getOrThrow('IDENTITY_HUB_LOGIN_PATH'));
      loginUrl.searchParams.set('auth_request_id', oAuthRequestId);
      return loginUrl.toString();
    }

    await this.authService.checkUserAppAccess(session.userId, app.id);

    const code = await this.createAuthCode(session.userId, params);

    const resultUrl = new URL(params.redirectUri);

    resultUrl.searchParams.set('code', code);

    return resultUrl.toString();
  }

  async handleLoginRequest(dto: LoginDto) {
    const user = await this.authService.authenticateUser(dto); // Login user;
    return await this.authService.createAuthSession(user); // Create session and returbn key;
  }

  async handleTokenRequest(dto: TokenRequestDto) {
    const app = await this.loadValidApplication(dto.clientId, dto.clientSecret);
    return dto.grantType === GrantType.AUTHORIZATION_CODE
      ? this.handleAuthorizationCodeGrant(dto, app)
      : this.handleRefreshTokenGrant(dto, app);
  }

  async resumeAuthorizeFlow({ authRequestId }: LoginParamsDto) {
    const loginUrl = this.configService.getOrThrow<string>('IDENTITY_HUB_APPS_PATH');
    if (!authRequestId) return loginUrl;

    const pendingReq = await this.consumePendingOAuthRequest(authRequestId);
    if (!pendingReq) return loginUrl;

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
    const url = new URL(this.configService.getOrThrow<string>('IDENTITY_HUB_LOGIN_PATH'));
    url.searchParams.set('error', error.code);
    if (authRequestId) {
      url.searchParams.set('auth_request_id', authRequestId);
    }
    return url.toString();
  }

  private async handleAuthorizationCodeGrant(dto: TokenRequestDto, app: Application) {
    const key = `auth_code:${dto.code}`;
    const raw = await this.redis.get(key);

    if (!raw) throw new UnauthorizedException('Invalid or expired code.');

    const context = JSON.parse(raw) as AuthorizationCodePayload;

    if (context.clientId !== dto.clientId || context.redirectUri !== dto.redirectUri) {
      throw new UnauthorizedException('Invalid client.');
    }

    await this.redis.del(key);

    const user = await this.checkValidUser(context.userId);
    console.log('CALL - exchange code');
    return await this.tokenService.generateTokenPair({
      sub: user.id,
      externalKey: user.externalKey,
      name: user.fullName,
      userType: app.clientProfile,
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
    console.log('CALL - refresh token');
    return await this.tokenService.generateTokenPair({
      sub: user.id,
      name: user.fullName,
      userType: app.clientProfile,
      externalKey: user.externalKey,
      clientId: data.clientId,
      scope: data.scope,
    });
  }

  private async createAuthCode(userId: string, { clientId, redirectUri, scope }: AuthorizeParamsDto) {
    const code = crypto.randomUUID();
    const key = `auth_code:${code}`;
    const payload: AuthorizationCodePayload = {
      userId,
      clientId,
      redirectUri,
      scope,
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', 5 * 60 * 1000);
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
    const app = await this.appRepository.findOne({ where: { clientId, isActive: true } });
    if (!app) throw new UnauthorizedException('Invalid client id.');

    if (app.isConfidential) {
      if (!clientSecret) throw new UnauthorizedException('Client secret is required.');
      const isSecretValid = await compare(clientSecret, app.clientSecret);
      if (!isSecretValid) {
        throw new UnauthorizedException('Invalid client secret.');
      }
    }
    return app;
  }

  private async createPendingOAuthRequest(params: AuthorizeParamsDto) {
    const oAuthRequestId = crypto.randomUUID();
    const key = `pending_oauth:${oAuthRequestId}`;
    await this.redis.set(key, JSON.stringify(params), 'EX', 5 * 60 * 1000);
    return oAuthRequestId;
  }

  private async consumePendingOAuthRequest(oAuthRequestId: string) {
    const key = `pending_oauth:${oAuthRequestId}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    await this.redis.del(key);
    return JSON.parse(data) as AuthorizeParamsDto;
  }
}
