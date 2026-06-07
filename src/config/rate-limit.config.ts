export const RATE_LIMIT_TTL_MS = 60_000;

export const RATE_LIMITS = {
  DEFAULT: 60,
  LOGIN: 10,
  TOKEN: 30,
  INTERNAL: 120,
} as const;
