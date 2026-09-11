import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import type { Response } from 'express';

import { AllowPasswordChange, Cookies, GetAuthUser, Public } from '../decorators';
import { EnvironmentVariables } from 'src/config';
import type { AuthUser } from '../interfaces';
import { ChangePasswordDto, CompletePasswordActionDto, ForgotPasswordDto, LoginParamsDto } from '../dtos';
import { AuthService, OAuthService, PasswordActionService } from '../services';
import {
  buildSessionCookieClearOptions,
  buildSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '../constants/session.constants';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from 'src/config/rate-limit.config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly oauthService: OAuthService,
    private readonly passwordActionService: PasswordActionService,
  ) {}

  @AllowPasswordChange()
  @Get('status')
  checkAuthStatus(@GetAuthUser() user: AuthUser) {
    return { user };
  }

  @AllowPasswordChange()
  @Get('oauth/resume')
  async resumeOAuth(
    @GetAuthUser() user: AuthUser,
    @Query() queryParams: LoginParamsDto,
    @Cookies(SESSION_COOKIE_NAME) sessionId: string,
  ) {
    const redirectUrl = await this.oauthService.resolvePostLoginRedirect(
      queryParams,
      sessionId,
      user.mustChangePassword,
    );
    return { redirectUrl };
  }

  @Public()
  @Post('logout')
  async logout(
    @Cookies(SESSION_COOKIE_NAME) sessionId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieSecure = this.configService.getOrThrow('IDENTITY_COOKIE_SECURE', { infer: true });
    const cookieSameSite = this.configService.getOrThrow('IDENTITY_COOKIE_SAME_SITE', { infer: true });
    const result = await this.authService.logout(sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, buildSessionCookieClearOptions(cookieSecure, cookieSameSite));
    return result;
  }

  @AllowPasswordChange()
  @Patch('change-password')
  async changePassword(
    @GetAuthUser('id') userId: string,
    @Body() body: ChangePasswordDto,
    @Query() queryParams: LoginParamsDto,
    @Cookies(SESSION_COOKIE_NAME) sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (body.newPassword !== body.passwordConfirmation) {
      throw new BadRequestException('Password confirmation does not match.');
    }

    const { sessionId: newSessionId } = await this.authService.completeAuthenticatedPasswordChange(
      userId,
      body.currentPassword,
      body.newPassword,
    );
    const cookieSecure = this.configService.getOrThrow('IDENTITY_COOKIE_SECURE', { infer: true });
    const cookieSameSite = this.configService.getOrThrow('IDENTITY_COOKIE_SAME_SITE', { infer: true });
    response.cookie(SESSION_COOKIE_NAME, newSessionId, buildSessionCookieOptions(cookieSecure, cookieSameSite));
    const redirectUrl = await this.oauthService.resumeAuthorizeFlow(queryParams, sessionId);
    return { message: 'Password changed successfully', redirectUrl };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMITS.PASSWORD_RECOVERY } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    await this.passwordActionService.requestRecovery(body.identifier);
    return { message: 'If the account is eligible, password recovery instructions will be sent.' };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMITS.PASSWORD_ACTION } })
  @Post('password-actions/complete')
  @HttpCode(HttpStatus.OK)
  completePasswordAction(@Body() body: CompletePasswordActionDto) {
    return this.passwordActionService.completePasswordAction(body);
  }
}
