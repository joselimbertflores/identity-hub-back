import type { CookieOptions } from 'express';

export const SESSION_TTL_SECONDS = 10 * 60 * 60;
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;
export const SESSION_COOKIE_NAME = 'session_id';
export const SESSION_REDIS_KEY_PREFIX = 'session:';

export function buildSessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

export function buildSessionCookieClearOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  };
}

export function buildSessionRedisKey(sessionId: string): string {
  return `${SESSION_REDIS_KEY_PREFIX}${sessionId}`;
}
