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

  /**
   * Maneja la lógica del endpoint /oauth/authorize.
   *
   * Responsabilidades:
   *
   * 1. Validar cliente (client_id)
   * 2. Validar redirect_uri
   * 3. Verificar sesión del usuario en Identity Hub
   * 4. Si no hay sesión → redirigir a login
   * 5. Si hay sesión → verificar acceso del usuario a la aplicación
   * 6. Generar authorization code
   * 7. Redirigir al cliente con code + state
   */
  async handleAuthorizeRequest(params: AuthorizeParamsDto, sessionId: string | undefined) {
    const app = await this.appRepository.findOne({ where: { clientId: params.clientId, isActive: true } });
    if (!app) throw new UnauthorizedException('Invalid client.');
    if (!app.redirectUris.includes(params.redirectUri)) throw new UnauthorizedException('Invalid redirect uri.');

    const session = sessionId ? await this.authService.getAuthSession(sessionId) : null;
    /**
     * Si el usuario no tiene sesión:
     * guardamos el request OAuth temporalmente en Redis
     * y redirigimos al login del Identity Hub.
     */
    if (!session) {
      const oAuthRequestId = await this.createPendingOAuthRequest(params);
      const loginUrl = new URL(this.configService.getOrThrow('IDENTITY_HUB_LOGIN_PATH'));
      // auth_request_id permite reanudar el flujo después del login
      loginUrl.searchParams.set('auth_request_id', oAuthRequestId);
      return loginUrl.toString();
    }

    /**
     * 4. El usuario ya tiene sesión en Identity Hub
     * verificamos que tenga acceso a la aplicación solicitada.
     */
    const hasAccess = await this.authService.checkUserAppAccess(session.userId, app.id);
    console.log(hasAccess);
    if (!hasAccess) {
      // No tiene acceso devolver al cliente para que maneje su vista de error
      const url = new URL(params.redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (params.state) url.searchParams.set('state', params.state);
      console.log(url.toString());
      return url.toString();
    }

    /**
     * Generar authorization code
     *
     * Este code se almacenará temporalmente en Redis
     * y será intercambiado posteriormente en /oauth/token.
     */
    const code = await this.createAuthCode(session.userId, params);

    const resultUrl = new URL(params.redirectUri);

    // El cliente recibirá este code para intercambiarlo por tokens
    resultUrl.searchParams.set('code', code);

    /**
     * El parámetro state es devuelto intacto al cliente.
     * El cliente debe validar que coincida con el enviado originalmente.
     */
    if (params.state) {
      resultUrl.searchParams.set('state', params.state);
    }

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

  /**
   * Reanuda el flujo OAuth después del login.
   *
   * Si el login fue iniciado por un cliente OAuth,
   * existirá auth_request_id y se reconstruirá el
   * request /oauth/authorize original.
   *
   * Si el login fue directo al Identity Hub,
   * no habrá auth_request_id y el usuario será
   * redirigido al portal de aplicaciones.
   */
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

  /**
   * Genera un Authorization Code OAuth.
   *
   * Características:
   * - uso único
   * - TTL corto (5 minutos)
   * - almacenado en Redis
   *
   * Este code será intercambiado en /oauth/token
   * para obtener access_token y refresh_token.
   */
  private async createAuthCode(userId: string, { clientId, redirectUri, scope }: AuthorizeParamsDto) {
    const code = crypto.randomUUID();
    const key = `auth_code:${code}`;
    const payload: AuthorizationCodePayload = {
      userId,
      clientId,
      redirectUri,
      scope,
      createdAt: Date.now(),
    };
    // Authorization codes viven poco tiempo
    await this.redis.set(key, JSON.stringify(payload), 'EX', 5 * 60);
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

  /**
   * Guarda temporalmente una solicitud OAuth pendiente.
   *
   * Esto permite el flujo:
   *
   * authorize → login → authorize
   *
   * Cuando el usuario hace login, el sistema recupera esta
   * solicitud para continuar el flujo original.
   *
   * TTL corto para evitar reutilización o almacenamiento prolongado.
   */
  private async createPendingOAuthRequest(params: AuthorizeParamsDto) {
    const oAuthRequestId = crypto.randomUUID();
    const key = `pending_oauth:${oAuthRequestId}`;
    await this.redis.set(key, JSON.stringify(params), 'EX', 5 * 60);
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
