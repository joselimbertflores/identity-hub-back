import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Response } from 'express';

import { AllowPasswordChange, Cookies, GetAuthUser, Public } from '../decorators';
import { UsersService } from 'src/modules/users/services/users.service';
import { EnvironmentVariables } from 'src/config';
import type { AuthUser } from '../interfaces';
import { ChangePasswordDto } from '../dtos';
import { AuthService } from '../services';
import { SESSION_COOKIE_NAME } from '../constants/session.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UsersService,
    private configService: ConfigService<EnvironmentVariables>,
  ) {}

  @AllowPasswordChange()
  @Get('status')
  checkAuthStatus(@GetAuthUser() user: AuthUser) {
    return { user };
  }

  @Public()
  @Post('logout')
  async logout(@Cookies(SESSION_COOKIE_NAME) sessionId: string | undefined, @Res({ passthrough: true }) response: Response) {
    const cookieSecure = this.configService.getOrThrow<boolean>('IDENTITY_COOKIE_SECURE');
    const result = await this.authService.removeAuthSession(sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      path: '/',
    });
    return result;
  }

  @AllowPasswordChange()
  @Patch('change-password')
  changePassword(@GetAuthUser('id') userId: string, @Body() body: ChangePasswordDto) {
    return this.userService.changePassword(userId, body.password);
  }
}
