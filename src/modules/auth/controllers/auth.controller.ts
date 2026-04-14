import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';

import type { Response } from 'express';

import { AllowPasswordChange, Cookies, GetAuthUser, Public } from '../decorators';
import { UsersService } from 'src/modules/users/users.service';
import { UpdateUserProfileDto } from 'src/modules/users/dtos';
import type { AuthUser } from '../interfaces';
import { ChangePasswordDto } from '../dtos';
import { AuthService } from '../services';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UsersService,
  ) {}

  @AllowPasswordChange()
  @Get('status')
  checkAuthStatus(@GetAuthUser() user: AuthUser) {
    console.log("CHECK AUTH STATUS");
    return { user };
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

  @AllowPasswordChange()
  @Patch('change-password')
  changePassword(@GetAuthUser('id') userId: string, @Body() body: ChangePasswordDto) {
    return this.userService.changePassword(userId, body.password);
  }

  @Patch('profile')
  updateUserProfile(@GetAuthUser('id') userId: string, @Body() body: UpdateUserProfileDto) {
    return this.userService.updateUserProfile(userId, body);
  }
}
