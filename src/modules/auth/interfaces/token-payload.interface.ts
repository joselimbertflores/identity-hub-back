export class AccessTokenPayload {
  sub: string;
  externalKey: string;
  name: string;
  // userType: string;
  clientId: string;
  scope?: string;
}

export class RefreshTokenPayload {
  userId: string;
  clientId: string;
  scope?: string;
}
