import type { AuthorizeParamsDto } from '../dtos';

export interface AuthorizationCodePayload {
  userId: string;
  sid: string;
  credentialVersion: number;
  clientId: string;
  redirectUri: string;
  scope: 'openid';
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export function isAuthorizationCodePayload(value: unknown): value is AuthorizationCodePayload {
  if (!value || typeof value !== 'object') return false;

  const payload = value as AuthorizationCodePayload;
  return (
    typeof payload.userId === 'string' &&
    typeof payload.sid === 'string' &&
    Number.isInteger(payload.credentialVersion) &&
    typeof payload.clientId === 'string' &&
    typeof payload.redirectUri === 'string' &&
    payload.scope === 'openid' &&
    typeof payload.nonce === 'string' &&
    payload.nonce.length > 0 &&
    typeof payload.codeChallenge === 'string' &&
    payload.codeChallengeMethod === 'S256'
  );
}

export interface PendingAuthorizationRequest {
  params: AuthorizeParamsDto;
  sessionId?: string;
}

export type TokenClientAuthentication =
  | {
      method: 'basic';
      clientId: string;
      clientSecret: string;
    }
  | {
      method: 'none';
      clientId: string;
    };

export interface OAuthTokenResponse {
  access_token: string;
  id_token: string;
  token_type: 'Bearer';
  expires_in: number;
}
