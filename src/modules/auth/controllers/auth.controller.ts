import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Response } from 'express';

import { AllowPasswordChange, Cookies, GetAuthUser, Public } from '../decorators';
import { UsersService } from 'src/modules/users/services/users.service';
import { EnvironmentVariables } from 'src/config';
import type { AuthUser } from '../interfaces';
import { ChangePasswordDto } from '../dtos';
import { AuthService } from '../services';

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
  async logout(@Cookies('session_id') sessionId: string | undefined, @Res({ passthrough: true }) response: Response) {
    const cookieSecure = this.configService.getOrThrow('IDENTITY_COOKIE_SECURE') === 'true';
    const result = await this.authService.removeAuthSession(sessionId);
    response.clearCookie('session_id', {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
    });
    return result;
  }

  @AllowPasswordChange()
  @Patch('change-password')
  changePassword(@GetAuthUser('id') userId: string, @Body() body: ChangePasswordDto) {
    return this.userService.changePassword(userId, body.password);
  }
}
