import { Controller, Get, Post, Res } from '@nestjs/common';

import type { Response } from 'express';

import { User } from 'src/modules/users/entities';

import { Cookies, GetAuthUser, Public } from '../decorators';
import { AuthService } from '../services';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('status')
  checkAuthStatus(@GetAuthUser() user: User) {
    return { user: user };
  }

  @Public()
  @Post('logout')
  async logout(@Cookies('session_id') sessionId: string | undefined, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.removeAuthSession(sessionId);
    response.clearCookie('session_id', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    });
    return result;
  }
}
