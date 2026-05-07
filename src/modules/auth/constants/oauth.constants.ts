export const OAUTH_JWT_KEY_ID = 'main-key';

export const AUTH_CODE_KEY_PREFIX = 'auth_code:';
export const PENDING_AUTH_REQUEST_KEY_PREFIX = 'pending_oauth:';
export const REFRESH_TOKEN_KEY_PREFIX = 'refresh:';
export const USER_REFRESH_TOKENS_KEY_PREFIX = 'user_refresh_tokens:';

export const AUTH_CODE_TTL_SECONDS = 5 * 60;
export const PENDING_AUTH_REQUEST_TTL_SECONDS = 5 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 10 * 60 * 60;

export const IDENTITY_HUB_UI_PATHS = {
  LOGIN: '/login',
  HOME: '/home/welcome',
  ERROR: '/auth/error',
} as const;
