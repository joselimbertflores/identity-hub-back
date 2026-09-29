export interface AccessTokenPayload {
  sub: string;
  sid: string;
  externalKey: string;
  name: string;
  clientId: string;
  scope: 'openid';
}

export interface IdTokenPayload {
  sub: string;
  sid: string;
  externalKey: string;
  name: string;
  nonce: string;
}

export interface IssuedTokens {
  accessToken: string;
  idToken: string;
  accessTokenExpiresIn: number;
  tokenType: 'Bearer';
}
