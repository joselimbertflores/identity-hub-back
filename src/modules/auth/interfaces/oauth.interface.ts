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
