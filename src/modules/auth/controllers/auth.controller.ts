import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
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
import { UsersService } from 'src/modules/users/services/users.service';
import { EnvironmentVariables } from 'src/config';
import type { AuthUser } from '../interfaces';
import { ChangePasswordDto, CompletePasswordActionDto, ForgotPasswordDto, LoginParamsDto } from '../dtos';
import { AuthService, MailService, OAuthService, PasswordActionService, TokenService } from '../services';
import { buildSessionCookieClearOptions, SESSION_COOKIE_NAME } from '../constants/session.constants';
import { RATE_LIMIT_TTL_MS, RATE_LIMITS } from 'src/config/rate-limit.config';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UsersService,
    private readonly configService: ConfigService<EnvironmentVariables>,
    private readonly oauthService: OAuthService,
    private readonly passwordActionService: PasswordActionService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
  ) {}

  @AllowPasswordChange()
  @Get('status')
  checkAuthStatus(@GetAuthUser() user: AuthUser) {
    return { user };
  }

  @Public()
  @Post('logout')
  async logout(
    @Cookies(SESSION_COOKIE_NAME) sessionId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieSecure = this.configService.getOrThrow<string>('IDENTITY_COOKIE_SECURE') === 'true';
    const result = await this.authService.removeAuthSession(sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, buildSessionCookieClearOptions(cookieSecure));
    return result;
  }

  @AllowPasswordChange()
  @Patch('change-password')
  async changePassword(
    @GetAuthUser('id') userId: string,
    @Body() body: ChangePasswordDto,
    @Query() queryParams: LoginParamsDto,
    @Cookies(SESSION_COOKIE_NAME) sessionId: string,
  ) {
    if (body.newPassword !== body.passwordConfirmation) {
      throw new BadRequestException('Password confirmation does not match.');
    }

    const user = await this.userService.changePassword(userId, body.currentPassword, body.newPassword);
    await this.tokenService.revokeAllForUserBestEffort(userId);
    try {
      await this.mailService.sendPasswordChanged(user);
    } catch {
      this.logger.warn('Password change notification delivery failed');
    }

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
    return this.passwordActionService.complete(body);
  }
}
