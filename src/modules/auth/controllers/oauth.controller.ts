import { Get, Res, Post, Body, Query, Controller } from '@nestjs/common';
import type { Response } from 'express';

import { LoginDto, LoginParamsDto, TokenRequestDto, AuthorizeParamsDto } from '../dtos';

import { AuthException } from '../exceptions/auth.exception';
import { Cookies, Public } from '../decorators';
import { OAuthService } from '../services';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/config';
import { SESSION_COOKIE_MAX_AGE_MS, SESSION_COOKIE_NAME } from '../constants/session.constants';

@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly oAuthService: OAuthService,
    private readonly configService: ConfigService<EnvironmentVariables>,
  ) {}

  @Public()
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeParamsDto,
    @Cookies(SESSION_COOKIE_NAME) sessionId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const url = await this.oAuthService.handleAuthorizeRequest(query, sessionId);
    return res.redirect(url);
  }

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto, @Query() queryParams: LoginParamsDto, @Res({ passthrough: true }) res: Response) {
    const secure = this.configService.getOrThrow<boolean>('IDENTITY_COOKIE_SECURE');

    try {
      const sessionId = await this.oAuthService.handleLoginRequest(body);

      res.cookie(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
        path: '/',
      });

      const redirectUrl = await this.oAuthService.resumeAuthorizeFlow(queryParams);
      return res.redirect(redirectUrl);
    } catch (error: unknown) {
      if (error instanceof AuthException) {
        const redirectUrl = this.oAuthService.resolveLoginErrorRedirect(error, queryParams);
        return res.redirect(redirectUrl);
      }
      throw error;
    }
  }

  @Public()
  @Post('token')
  token(@Body() body: TokenRequestDto) {
    // OAuth token endpoint is machine-to-machine: JSON response, never browser redirects.
    return this.oAuthService.handleTokenRequest(body);
  }
}
