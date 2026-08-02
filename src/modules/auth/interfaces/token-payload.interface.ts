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
  credentialVersion: number;
  scope?: string;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  tokenType: 'Bearer';
}

export interface PreparedTokenPair {
  tokens: IssuedTokenPair;
  refreshTokenPayload: RefreshTokenPayload;
}

export interface StoredRefreshToken {
  raw: string;
  payload: RefreshTokenPayload;
}
