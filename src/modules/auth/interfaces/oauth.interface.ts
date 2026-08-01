import type { AuthorizeParamsDto } from '../dtos';

export interface AuthorizationCodePayload {
  userId: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  createdAt: number;
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
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token_expires_in: number;
}
