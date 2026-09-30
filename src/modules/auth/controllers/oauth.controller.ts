import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Response } from 'express';

import { AuthorizeParamsDto, LoginDto, LoginParamsDto, TokenRequestDto } from '../dtos';
import { AuthException } from '../exceptions/auth.exception';
import { OAuthTokenErrorCode, OAuthTokenException } from '../exceptions/oauth-token.exception';
import { Cookies, Public } from '../decorators';
import { AuthService, OAuthService, TokenService } from '../services';
import { OAuthTokenResponse, TokenClientAuthentication } from '../interfaces';
import { EnvironmentVariables } from 'src/config';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from 'src/config/rate-limit.config';
import { buildSessionCookieOptions, SESSION_COOKIE_NAME } from '../constants/session.constants';

const TOKEN_FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

interface BasicClientCredentials {
  clientId: string;
  clientSecret: string;
}

@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Public()
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeParamsDto,
    @Cookies(SESSION_COOKIE_NAME) sessionId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const url = await this.oauthService.handleAuthorizeRequest(query, sessionId);
    return res.redirect(url);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMITS.LOGIN } })
  @Post('login')
  async login(@Body() body: LoginDto, @Query() queryParams: LoginParamsDto, @Res({ passthrough: true }) res: Response) {
    const secure = this.configService.getOrThrow('IDENTITY_COOKIE_SECURE', { infer: true });
    const sameSite = this.configService.getOrThrow('IDENTITY_COOKIE_SAME_SITE', { infer: true });

    try {
      const { sessionId } = await this.authService.signIn(body);
      res.cookie(SESSION_COOKIE_NAME, sessionId, buildSessionCookieOptions(secure, sameSite));

      const redirectUrl = await this.oauthService.resolvePostLoginRedirect(queryParams, sessionId);
      return res.redirect(redirectUrl);
    } catch (error: unknown) {
      if (error instanceof AuthException) {
        const redirectUrl = this.oauthService.buildLoginErrorRedirectUrl(error, queryParams);
        return res.redirect(redirectUrl);
      }
      throw error;
    }
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMITS.TOKEN } })
  @HttpCode(HttpStatus.OK)
  @Post('token')
  async token(
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OAuthTokenResponse> {
    try {
      this.assertFormContentType(contentType);
      const form = this.assertTokenForm(body);
      const hasBodyClientSecret = Object.hasOwn(form, 'client_secret');

      if (authorization !== undefined && hasBodyClientSecret) {
        throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_REQUEST);
      }

      if (hasBodyClientSecret) {
        throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
      }

      const basicCredentials = this.parseBasicClientCredentials(authorization);
      const request = await this.parseTokenRequest(form, basicCredentials?.clientId);
      const authentication = this.resolveClientAuthentication(request.clientId, basicCredentials);
      const tokens = await this.tokenService.handleTokenRequest(request, authentication);

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');

      return {
        access_token: tokens.accessToken,
        id_token: tokens.idToken,
        token_type: tokens.tokenType,
        expires_in: tokens.accessTokenExpiresIn,
      };
    } catch (error: unknown) {
      const endpointError =
        error instanceof UnauthorizedException ? new OAuthTokenException(OAuthTokenErrorCode.INVALID_GRANT) : error;

      if (endpointError instanceof OAuthTokenException) {
        for (const [name, value] of Object.entries(endpointError.headers)) {
          res.setHeader(name, value);
        }
      }

      throw endpointError;
    }
  }

  private assertFormContentType(contentType: string | undefined): void {
    const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== TOKEN_FORM_CONTENT_TYPE) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_REQUEST);
    }
  }

  private assertTokenForm(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_REQUEST);
    }

    return body as Record<string, unknown>;
  }

  private async parseTokenRequest(form: Record<string, unknown>, basicClientId?: string): Promise<TokenRequestDto> {
    const grantType = form.grant_type;
    if (typeof grantType !== 'string' || !grantType) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_REQUEST);
    }

    if (grantType !== 'authorization_code') {
      throw new OAuthTokenException(OAuthTokenErrorCode.UNSUPPORTED_GRANT_TYPE);
    }

    const normalizedForm =
      basicClientId && !Object.hasOwn(form, 'client_id') ? { ...form, client_id: basicClientId } : form;
    const request = plainToInstance(TokenRequestDto, normalizedForm, { excludeExtraneousValues: true });
    const errors = await validate(request);
    if (errors.length > 0) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_REQUEST);
    }
    return request;
  }

  private resolveClientAuthentication(
    clientId: string,
    basicCredentials: BasicClientCredentials | null,
  ): TokenClientAuthentication {
    if (basicCredentials) {
      return {
        method: 'basic',
        clientId: basicCredentials.clientId,
        clientSecret: basicCredentials.clientSecret,
      };
    }

    return { method: 'none', clientId };
  }

  private parseBasicClientCredentials(authorization: string | undefined): BasicClientCredentials | null {
    if (authorization === undefined) return null;

    const match = /^Basic[ \t]+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    if (!match) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    const encodedCredentials = match[1];
    const remainder = encodedCredentials.length % 4;
    if (remainder === 1) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    const normalizedCredentials = encodedCredentials.padEnd(encodedCredentials.length + ((4 - remainder) % 4), '=');
    const credentialBytes = Buffer.from(normalizedCredentials, 'base64');
    if (credentialBytes.toString('base64') !== normalizedCredentials) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    const encodedPair = credentialBytes.toString('utf8');
    if (!Buffer.from(encodedPair, 'utf8').equals(credentialBytes)) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    const separatorIndex = encodedPair.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === encodedPair.length - 1) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    const clientId = this.decodeFormComponent(encodedPair.slice(0, separatorIndex));
    const clientSecret = this.decodeFormComponent(encodedPair.slice(separatorIndex + 1));
    if (!clientId || !clientSecret) {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }

    return { clientId, clientSecret };
  }

  private decodeFormComponent(value: string): string {
    try {
      return decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      throw new OAuthTokenException(OAuthTokenErrorCode.INVALID_CLIENT);
    }
  }
}
