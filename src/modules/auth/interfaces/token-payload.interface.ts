export class AccessTokenPayload {
  sub: string;
  sid: string;
  externalKey: string;
  name: string;
  clientId: string;
  scope?: string;
}

export class RefreshTokenPayload {
  userId: string;
  sid: string;
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
  tokens: Omit<IssuedTokenPair, 'refreshTokenExpiresIn'>;
  refreshTokenPayload: RefreshTokenPayload;
}

export interface StoredRefreshToken {
  raw: string;
  payload: RefreshTokenPayload;
}
