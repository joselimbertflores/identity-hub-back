import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

import { AuthSessionPayload, isAuthSessionPayload, RevokedSessionContext } from '../interfaces';
import {
  buildSessionBySidKey,
  buildSessionRedisKey,
  SESSION_BY_SID_KEY_PREFIX,
  SESSION_CLIENTS_KEY_PREFIX,
  SESSION_TTL_SECONDS,
} from '../constants/session.constants';

const CREATE_SESSION_SCRIPT = `
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local expiresAt = now + tonumber(ARGV[2])
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', expiresAt)
redis.call('SET', KEYS[2], KEYS[1], 'PXAT', expiresAt)
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
redis.call('ZADD', KEYS[3], expiresAt, KEYS[1])
redis.call('PEXPIREAT', KEYS[3], expiresAt)
return 1
`;

const REMOVE_SESSION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], KEYS[1])
  return nil
end
local ok, session = pcall(cjson.decode, raw)
if not ok or type(session) ~= 'table' or type(session.sid) ~= 'string'
  or session.userId ~= ARGV[1] then
  return nil
end
local clientsKey = ARGV[3] .. session.sid
local clients = redis.call('SMEMBERS', clientsKey)
redis.call('DEL', KEYS[1], ARGV[2] .. session.sid, clientsKey)
redis.call('ZREM', KEYS[2], KEYS[1])
local result = {session.sid, session.userId}
for _, clientId in ipairs(clients) do
  table.insert(result, clientId)
end
return result
`;

const REVOKE_USER_SESSIONS_SCRIPT = `
local sessions = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, sessionKey in ipairs(sessions) do
  local raw = redis.call('GET', sessionKey)
  if raw then
    local ok, session = pcall(cjson.decode, raw)
    if ok and type(session) == 'table' and type(session.sid) == 'string' then
      redis.call('DEL', ARGV[1] .. session.sid, ARGV[2] .. session.sid)
    end
  end
  redis.call('DEL', sessionKey)
end
redis.call('DEL', KEYS[1])
return #sessions
`;

@Injectable()
export class SessionService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async create(session: Omit<AuthSessionPayload, 'sid'>): Promise<string> {
    const sessionId = randomUUID();
    const payload: AuthSessionPayload = { ...session, sid: randomUUID() };
    if (!isAuthSessionPayload(payload)) throw new Error('Invalid session payload');

    await this.redis.eval(
      CREATE_SESSION_SCRIPT,
      3,
      buildSessionRedisKey(sessionId),
      buildSessionBySidKey(payload.sid),
      this.buildUserSessionsKey(session.userId),
      JSON.stringify(payload),
      SESSION_TTL_SECONDS * 1000,
    );
    return sessionId;
  }

  async get(sessionId: string): Promise<AuthSessionPayload | null> {
    const raw = await this.redis.get(buildSessionRedisKey(sessionId));
    if (!raw) return null;
    try {
      const session: unknown = JSON.parse(raw);
      return isAuthSessionPayload(session) ? session : null;
    } catch {
      return null;
    }
  }

  async remove(sessionId: string, userId: string): Promise<RevokedSessionContext | null> {
    const result = (await this.redis.eval(
      REMOVE_SESSION_SCRIPT,
      2,
      buildSessionRedisKey(sessionId),
      this.buildUserSessionsKey(userId),
      userId,
      SESSION_BY_SID_KEY_PREFIX,
      SESSION_CLIENTS_KEY_PREFIX,
    )) as string[] | null;
    if (!result) return null;
    const [sid, revokedUserId, ...clientIds] = result;
    return { sid, userId: revokedUserId, clientIds };
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.redis.eval(
      REVOKE_USER_SESSIONS_SCRIPT,
      1,
      this.buildUserSessionsKey(userId),
      SESSION_BY_SID_KEY_PREFIX,
      SESSION_CLIENTS_KEY_PREFIX,
    );
  }

  private buildUserSessionsKey(userId: string): string {
    return `user_sessions:${userId}`;
  }
}
