export const OAUTH_JWT_KEY_ID = 'main-key';

export const AUTH_CODE_KEY_PREFIX = 'auth_code:';
export const PENDING_AUTH_REQUEST_KEY_PREFIX = 'pending_oauth:';

export const AUTH_CODE_TTL_SECONDS = 5 * 60;
export const PENDING_AUTH_REQUEST_TTL_SECONDS = 5 * 60;
export const TOKEN_TTL_SECONDS = 10 * 60;
export const LOGOUT_TOKEN_TTL_SECONDS = 2 * 60;
export const BACKCHANNEL_LOGOUT_TIMEOUT_MS = 5_000;

export const IDENTITY_HUB_UI_PATHS = {
  LOGIN: '/login',
  HOME: '/home/welcome',
  ERROR: '/auth/error',
  PASSWORD_ACTION: '/set-password',
} as const;
