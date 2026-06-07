import { UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';

import { AuthorizeParamsDto, GrantType, TokenRequestDto } from '../dtos';
import { AuthorizationCodePayload } from '../interfaces';
import { OAuthService } from './oauth.service';
import { PkceService } from './pkce.service';

const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

function buildCodeChallenge(codeVerifier = CODE_VERIFIER): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function hasValidationError(errors: Awaited<ReturnType<typeof validate>>, property: string): boolean {
  return errors.some((error) => error.property === property);
}

function createService(
  context: AuthorizationCodePayload,
  tokenPair = { accessToken: 'access', refreshToken: 'refresh' },
) {
  const app = {
    id: 1,
    clientId: context.clientId,
    isActive: true,
    isConfidential: false,
    redirectUris: [context.redirectUri],
  };
  const user = {
    id: context.userId,
    externalKey: 'IDH-U-TEST',
    fullName: 'Test User',
  };

  const appQueryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(app),
  };
  const appRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(appQueryBuilder),
    findOne: jest.fn().mockResolvedValue(app),
  };
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(user),
  };
  const redis = {
    getdel: jest.fn().mockResolvedValue(JSON.stringify(context)),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const tokenService = {
    generateTokenPair: jest.fn().mockResolvedValue(tokenPair),
    revokeAllForUser: jest.fn(),
  };
  const authService = {
    getAuthSession: jest.fn().mockResolvedValue({ userId: context.userId, fullName: user.fullName }),
    checkUserAppAccess: jest.fn().mockResolvedValue(true),
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('http://identity.local'),
  };

  const service = new OAuthService(
    appRepository as any,
    userRepository as any,
    redis as any,
    configService as any,
    tokenService as any,
    authService as any,
    new PkceService(),
  );

  return { service, appRepository, redis, tokenService };
}

describe('OAuth PKCE', () => {
  it('rejects authorize requests without code_challenge', async () => {
    const dto = plainToInstance(AuthorizeParamsDto, {
      client_id: 'gaceta',
      redirect_uri: 'http://localhost/callback',
      response_type: 'code',
      code_challenge_method: 'S256',
    });

    const errors = await validate(dto);

    expect(hasValidationError(errors, 'codeChallenge')).toBe(true);
  });

  it('rejects authorize requests with a code_challenge_method different from S256', async () => {
    const dto = plainToInstance(AuthorizeParamsDto, {
      client_id: 'gaceta',
      redirect_uri: 'http://localhost/callback',
      response_type: 'code',
      code_challenge: buildCodeChallenge(),
      code_challenge_method: 'plain',
    });

    const errors = await validate(dto);

    expect(hasValidationError(errors, 'codeChallengeMethod')).toBe(true);
  });

  it('rejects authorize requests without state', async () => {
    const dto = plainToInstance(AuthorizeParamsDto, {
      client_id: 'gaceta',
      redirect_uri: 'http://localhost/callback',
      response_type: 'code',
      code_challenge: buildCodeChallenge(),
      code_challenge_method: 'S256',
    });

    const errors = await validate(dto);

    expect(hasValidationError(errors, 'state')).toBe(true);
  });

  it('rejects unsupported scope values', async () => {
    const dto = plainToInstance(AuthorizeParamsDto, {
      client_id: 'gaceta',
      redirect_uri: 'http://localhost/callback',
      response_type: 'code',
      state: 'state-123',
      scope: 'read:users',
      code_challenge: buildCodeChallenge(),
      code_challenge_method: 'S256',
    });

    const errors = await validate(dto);

    expect(hasValidationError(errors, 'scope')).toBe(true);
  });

  it('rejects token requests without code_verifier for authorization_code grant', async () => {
    const dto = plainToInstance(TokenRequestDto, {
      grant_type: 'authorization_code',
      client_id: 'gaceta',
      code: 'code',
      redirect_uri: 'http://localhost/callback',
    });

    const errors = await validate(dto);

    expect(hasValidationError(errors, 'codeVerifier')).toBe(true);
  });

  it('rejects token exchange when code_verifier does not match stored code_challenge', async () => {
    const context: AuthorizationCodePayload = {
      userId: 'user-id',
      clientId: 'gaceta',
      redirectUri: 'http://localhost/callback',
      codeChallenge: buildCodeChallenge(),
      codeChallengeMethod: 'S256',
      createdAt: Date.now(),
    };
    const { service, tokenService } = createService(context);

    await expect(
      service.handleTokenRequest({
        grantType: GrantType.AUTHORIZATION_CODE,
        clientId: context.clientId,
        code: 'code',
        redirectUri: context.redirectUri,
        codeVerifier: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tokenService.generateTokenPair).not.toHaveBeenCalled();
  });

  it('emits tokens when code_verifier matches stored code_challenge', async () => {
    const tokenPair = { accessToken: 'access', refreshToken: 'refresh' };
    const context: AuthorizationCodePayload = {
      userId: 'user-id',
      clientId: 'gaceta',
      redirectUri: 'http://localhost/callback',
      codeChallenge: buildCodeChallenge(),
      codeChallengeMethod: 'S256',
      createdAt: Date.now(),
    };
    const { service, tokenService } = createService(context, tokenPair);

    await expect(
      service.handleTokenRequest({
        grantType: GrantType.AUTHORIZATION_CODE,
        clientId: context.clientId,
        code: 'code',
        redirectUri: context.redirectUri,
        codeVerifier: CODE_VERIFIER,
      }),
    ).resolves.toEqual(tokenPair);

    expect(tokenService.generateTokenPair).toHaveBeenCalledWith({
      sub: context.userId,
      externalKey: 'IDH-U-TEST',
      name: 'Test User',
      clientId: context.clientId,
    });
  });

  it('does not redirect to an unregistered redirect_uri', async () => {
    const context: AuthorizationCodePayload = {
      userId: 'user-id',
      clientId: 'gaceta',
      redirectUri: 'http://localhost/callback',
      codeChallenge: buildCodeChallenge(),
      codeChallengeMethod: 'S256',
      createdAt: Date.now(),
    };
    const { service, redis } = createService(context);

    const redirectUrl = await service.handleAuthorizeRequest(
      {
        clientId: context.clientId,
        redirectUri: 'http://malicious.local/callback',
        responseType: 'code',
        state: 'state-123',
        codeChallenge: context.codeChallenge,
        codeChallengeMethod: 'S256',
      },
      'session-id',
    );

    expect(redirectUrl).toBe('http://identity.local/auth/error?error=invalid_redirect_uri');
    expect(redirectUrl).not.toContain('malicious.local');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('creates an authorization code for a valid authorize request and preserves state', async () => {
    const context: AuthorizationCodePayload = {
      userId: 'user-id',
      clientId: 'gaceta',
      redirectUri: 'http://localhost/callback',
      codeChallenge: buildCodeChallenge(),
      codeChallengeMethod: 'S256',
      createdAt: Date.now(),
    };
    const { service, redis } = createService(context);

    const redirectUrl = await service.handleAuthorizeRequest(
      {
        clientId: context.clientId,
        redirectUri: context.redirectUri,
        responseType: 'code',
        state: 'state-123',
        codeChallenge: context.codeChallenge,
        codeChallengeMethod: 'S256',
      },
      'session-id',
    );
    const url = new URL(redirectUrl);
    const storedPayload = JSON.parse((redis.set as jest.Mock).mock.calls[0][1]) as AuthorizationCodePayload;

    expect(url.origin + url.pathname).toBe(context.redirectUri);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(storedPayload).toMatchObject({
      userId: context.userId,
      clientId: context.clientId,
      redirectUri: context.redirectUri,
      codeChallenge: context.codeChallenge,
      codeChallengeMethod: 'S256',
    });
    expect(storedPayload.scope).toBeUndefined();
  });
});
