import { Get, Res, Post, Body, Query, Controller } from '@nestjs/common';
import type { Response } from 'express';

import { LoginDto, LoginParamsDto, TokenRequestDto, AuthorizeParamsDto } from '../dtos';

import { AuthException } from '../exceptions/auth.exception';
import { Cookies, Public } from '../decorators';
import { OAuthService } from '../services';

@Controller('oauth')
export class OAuthController {
  constructor(private readonly oAuthService: OAuthService) {}

  /**
   * OAuth Authorization Endpoint
   *
   * Este endpoint inicia el flujo OAuth Authorization Code.
   *
   * Flujo esperado:
   *
   * CLIENT → GET /oauth/authorize
   *      ↓
   * Identity Hub valida cliente y redirect_uri
   *      ↓
   * Si el usuario NO tiene sesión:
   *      guardar request pendiente en Redis
   *      redirigir al login del Identity Hub
   *
   * Si el usuario YA tiene sesión:
   *      verificar que el usuario tenga acceso a la aplicación
   *      generar authorization code
   *      redirigir al cliente con:
   *          redirect_uri?code=...&state=...
   *
   * El parámetro `state` es generado por el cliente y se devuelve intacto
   * para evitar ataques CSRF en el flujo OAuth.
   */
  @Public()
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeParamsDto,
    @Cookies('session_id') sessionId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const url = await this.oAuthService.handleAuthorizeRequest(query, sessionId);
     // Siempre redirige al siguiente paso del flujo OAuth
    return res.redirect(url);
  }

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto, @Query() queryParams: LoginParamsDto, @Res({ passthrough: true }) res: Response) {
    try {
      const sessionId = await this.oAuthService.handleLoginRequest(body);

      // max age like laboral hours
      res.cookie('session_id', sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 10 * 60 * 60 * 1000,
      });

      const redirectUrl = await this.oAuthService.resumeAuthorizeFlow(queryParams);
      console.log(redirectUrl);
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
    return this.oAuthService.handleTokenRequest(body);
  }
}
