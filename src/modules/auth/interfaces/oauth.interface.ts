export interface AuthorizationCodePayload {
  userId: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  createdAt: number;
}
