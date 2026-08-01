import { HttpException, HttpStatus } from '@nestjs/common';

export enum OAuthTokenErrorCode {
  INVALID_REQUEST = 'invalid_request',
  INVALID_CLIENT = 'invalid_client',
  INVALID_GRANT = 'invalid_grant',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
  UNSUPPORTED_GRANT_TYPE = 'unsupported_grant_type',
}

const ERROR_CONFIG: Record<OAuthTokenErrorCode, { description: string; status: HttpStatus }> = {
  [OAuthTokenErrorCode.INVALID_REQUEST]: {
    description: 'The token request is invalid.',
    status: HttpStatus.BAD_REQUEST,
  },
  [OAuthTokenErrorCode.INVALID_CLIENT]: {
    description: 'Client authentication failed.',
    status: HttpStatus.UNAUTHORIZED,
  },
  [OAuthTokenErrorCode.INVALID_GRANT]: {
    description: 'The authorization grant is invalid or expired.',
    status: HttpStatus.BAD_REQUEST,
  },
  [OAuthTokenErrorCode.UNAUTHORIZED_CLIENT]: {
    description: 'The authenticated client is not authorized to use this grant type.',
    status: HttpStatus.BAD_REQUEST,
  },
  [OAuthTokenErrorCode.UNSUPPORTED_GRANT_TYPE]: {
    description: 'The authorization grant type is not supported.',
    status: HttpStatus.BAD_REQUEST,
  },
};

export class OAuthTokenException extends HttpException {
  readonly headers: Readonly<Record<string, string>>;

  constructor(readonly code: OAuthTokenErrorCode) {
    const config = ERROR_CONFIG[code];
    super(
      {
        error: code,
        error_description: config.description,
      },
      config.status,
    );

    this.headers = code === OAuthTokenErrorCode.INVALID_CLIENT ? { 'WWW-Authenticate': 'Basic' } : {};
  }
}
