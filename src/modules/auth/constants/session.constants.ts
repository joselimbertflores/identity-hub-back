import type { CookieOptions } from 'express';
import type { IdentityCookieSameSite } from 'src/config';

export const SESSION_TTL_SECONDS = 10 * 60 * 60;
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;
export const SESSION_COOKIE_NAME = 'session_id';
export const SESSION_REDIS_KEY_PREFIX = 'session:';
export const SESSION_BY_SID_KEY_PREFIX = 'session_by_sid:';
export const SESSION_CLIENTS_KEY_PREFIX = 'session_clients:';

export function buildSessionCookieOptions(secure: boolean, sameSite: IdentityCookieSameSite): CookieOptions {
  return {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

export function buildSessionCookieClearOptions(secure: boolean, sameSite: IdentityCookieSameSite): CookieOptions {
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
  };
}

export function buildSessionRedisKey(sessionId: string): string {
  return `${SESSION_REDIS_KEY_PREFIX}${sessionId}`;
}

export function buildSessionBySidKey(sid: string): string {
  return `${SESSION_BY_SID_KEY_PREFIX}${sid}`;
}

export function buildSessionClientsKey(sid: string): string {
  return `${SESSION_CLIENTS_KEY_PREFIX}${sid}`;
}
