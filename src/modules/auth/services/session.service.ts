import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

import type { AuthSessionPayload } from '../interfaces';
import { buildSessionRedisKey, SESSION_TTL_SECONDS } from '../constants/session.constants';

const REVOKE_USER_SESSIONS_SCRIPT = `
local sessions = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, sessionKey in ipairs(sessions) do
  redis.call('DEL', sessionKey)
end
redis.call('DEL', KEYS[1])
return #sessions
`;

@Injectable()
export class SessionService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async create(session: AuthSessionPayload): Promise<string> {
    const sessionId = randomUUID();
    const sessionKey = buildSessionRedisKey(sessionId);
    const userKey = this.buildUserSessionsKey(session.userId);
    const now = Date.now();
    const results = await this.redis
      .multi()
      .set(sessionKey, JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)
      // Prune expired members even for users who sign in often enough to keep the index alive.
      .zremrangebyscore(userKey, '-inf', now)
      .zadd(userKey, now + SESSION_TTL_SECONDS * 1000, sessionKey)
      .expire(userKey, SESSION_TTL_SECONDS)
      .exec();
    if (!results || results.some(([error]) => error !== null)) {
      throw new Error('Session creation failed');
    }
    return sessionId;
  }

  async get(sessionId: string): Promise<AuthSessionPayload | null> {
    const raw = await this.redis.get(buildSessionRedisKey(sessionId));
    return raw ? (JSON.parse(raw) as AuthSessionPayload) : null;
  }

  async remove(sessionId: string, userId: string): Promise<void> {
    const sessionKey = buildSessionRedisKey(sessionId);
    const results = await this.redis.multi().del(sessionKey).zrem(this.buildUserSessionsKey(userId), sessionKey).exec();
    if (!results || results.some(([error]) => error !== null)) {
      throw new Error('Session removal failed');
    }
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.redis.eval(REVOKE_USER_SESSIONS_SCRIPT, 1, this.buildUserSessionsKey(userId));
  }

  private buildUserSessionsKey(userId: string): string {
    return `user_sessions:${userId}`;
  }
}
