import { isUUID } from 'class-validator';

export interface AuthSessionPayload {
  userId: string;
  credentialVersion: number;
  sid: string;
}

export interface RevokedSessionContext {
  sid: string;
  userId: string;
  clientIds: string[];
}

export function isAuthSessionPayload(value: unknown): value is AuthSessionPayload {
  if (!value || typeof value !== 'object') return false;
  const session = value as AuthSessionPayload;
  return (
    isUUID(session.userId) &&
    isUUID(session.sid, '4') &&
    Number.isInteger(session.credentialVersion) &&
    session.credentialVersion >= 0
  );
}
