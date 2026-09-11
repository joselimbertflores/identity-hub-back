import { BadRequestException } from '@nestjs/common';

export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'invalid_credentials',
  USER_DISABLED = 'user_disabled',
}

export class AuthException extends BadRequestException {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
  }
}
