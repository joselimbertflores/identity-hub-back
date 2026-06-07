import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { hash } from 'bcrypt';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { createHash, generateKeyPairSync } from 'crypto';

import { ApplicationClientAuthGuard } from 'src/modules/access/guards';
import { ApplicationClientAuthService } from 'src/modules/access/services';
import { Application } from 'src/modules/access/entities';
import { UsersDirectoryService } from 'src/modules/users/services';
import { User, UserRole } from 'src/modules/users/entities';
import { AuthorizeParamsDto, GrantType, TokenRequestDto } from '../dtos';
import { OAUTH_JWT_KEY_ID } from '../constants/oauth.constants';
import { SESSION_COOKIE_NAME } from '../constants/session.constants';
import { AuthErrorCode } from '../exceptions/auth.exception';
import { OAuthController } from '../controllers/oauth.controller';
import { JwksService, OAuthService, PkceService, TokenService } from '.';
import { AuthService } from './auth.service';

const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

interface TestUser extends Partial<User> {
  id: string;
  login: string;
  password: string;
  fullName: string;
  externalKey: string;
  isActive: boolean;
  mustChangePassword: boolean;
  roles: UserRole[];
  applicationIds: number[];
  email?: string;
}

interface TestApplication extends Partial<Application> {
  id: number;
  clientId: string;
  name: string;
  launchUrl: string;
  clientSecretHash: string;
  isConfidential: boolean;
  redirectUris: string[];
  isActive: boolean;
}

interface TestDb {
  users: TestUser[];
  applications: TestApplication[];
}

class InMemoryRedis {
  private values = new Map<string, { value: string; expiresAt?: number }>();
  private sets = new Map<string, { values: Set<string>; expiresAt?: number }>();

  async set(key: string, value: string, mode?: 'EX', seconds?: number) {
    this.values.set(key, {
      value,
      expiresAt: mode === 'EX' && seconds ? Date.now() + seconds * 1000 : undefined,
    });
    return 'OK';
  }

  async get(key: string) {
    const item = this.values.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return item.value;
  }

  async getdel(key: string) {
    const value = await this.get(key);
    this.values.delete(key);
    return value;
  }

  async del(key: string) {
    this.values.delete(key);
    this.sets.delete(key);
    return 1;
  }

  async sadd(key: string, value: string) {
    const item = this.getSet(key);
    item.values.add(value);
    return 1;
  }

  async srem(key: string, value: string) {
    const item = this.sets.get(key);
    item?.values.delete(value);
    return 1;
  }

  async smembers(key: string) {
    const item = this.sets.get(key);
    if (!item) return [];
    if (item.expiresAt && item.expiresAt <= Date.now()) {
      this.sets.delete(key);
      return [];
    }
    return [...item.values];
  }

  async expire(key: string, seconds: number) {
    const set = this.sets.get(key);
    if (set) set.expiresAt = Date.now() + seconds * 1000;
    const value = this.values.get(key);
    if (value) value.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  pipeline() {
    const commands: Array<() => Promise<unknown>> = [];
    return {
      sadd: (key: string, value: string) => {
        commands.push(() => this.sadd(key, value));
        return this;
      },
      expire: (key: string, seconds: number) => {
        commands.push(() => this.expire(key, seconds));
        return this;
      },
      del: (key: string) => {
        commands.push(() => this.del(key));
        return this;
      },
      exec: async () => Promise.all(commands.map((command) => command())),
    };
  }

  expireNow(key: string) {
    const value = this.values.get(key);
    if (value) value.expiresAt = Date.now() - 1;
  }

  private getSet(key: string) {
    let item = this.sets.get(key);
    if (!item) {
      item = { values: new Set<string>() };
      this.sets.set(key, item);
    }
    return item;
  }
}

class FakeUserQueryBuilder {
  private params: Record<string, unknown> = {};
  private externalKey?: string;
  private term?: string;

  constructor(private readonly db: TestDb) {}

  where(_condition: string, params?: Record<string, unknown>) {
    Object.assign(this.params, params);
    return this;
  }

  andWhere(condition: string, params?: Record<string, unknown>) {
    Object.assign(this.params, params);
    if (condition.includes('externalKey')) this.externalKey = params?.externalKey as string;
    return this;
  }

  orWhere(_condition: string, params?: Record<string, unknown>) {
    this.term = String(params?.term ?? '')
      .replaceAll('%', '')
      .toLowerCase();
    return this;
  }

  innerJoin(_relation?: string, _alias?: string, _condition?: string, params?: Record<string, unknown>) {
    Object.assign(this.params, params);
    return this;
  }

  addSelect() {
    return this;
  }

  select() {
    return this;
  }

  orderBy() {
    return this;
  }

  addOrderBy() {
    return this;
  }

  take() {
    return this;
  }

  async getOne() {
    if (this.params.login) {
      return this.db.users.find((user) => user.login === this.params.login) ?? null;
    }

    const users = await this.getMany();
    return users.find((user) => !this.externalKey || user.externalKey === this.externalKey) ?? null;
  }

  async getMany() {
    const applicationId = Number(this.params.applicationId);
    return this.db.users.filter((user) => {
      if (!user.isActive || !user.externalKey || !user.applicationIds.includes(applicationId)) return false;
      if (this.externalKey && user.externalKey !== this.externalKey) return false;
      const term = this.term;
      if (!term) return true;
      return [user.fullName, user.email, user.login].some((value) => value?.toLowerCase().includes(term));
    });
  }

  async getExists() {
    const user = this.db.users.find((item) => item.id === this.params.userId);
    const application = this.db.applications.find((item) => item.id === Number(this.params.applicationId));
    return Boolean(user?.isActive && application?.isActive && user.applicationIds.includes(application.id));
  }
}

class FakeUserRepository {
  constructor(private readonly db: TestDb) {}

  createQueryBuilder() {
    return new FakeUserQueryBuilder(this.db);
  }

  async findOneBy(where: Partial<User>) {
    return this.db.users.find((user) => user.id === where.id) ?? null;
  }

  async findOne({ where }: { where: Partial<User> }) {
    return (
      this.db.users.find((user) => {
        if (where.id && user.id !== where.id) return false;
        if (where.isActive !== undefined && user.isActive !== where.isActive) return false;
        return true;
      }) ?? null
    );
  }
}

class FakeApplicationQueryBuilder {
  private clientId?: string;

  constructor(private readonly db: TestDb) {}

  addSelect() {
    return this;
  }

  where(_condition: string, params: { clientId: string }) {
    this.clientId = params.clientId;
    return this;
  }

  andWhere() {
    return this;
  }

  async getOne() {
    return (
      this.db.applications.find((application) => application.clientId === this.clientId && application.isActive) ?? null
    );
  }
}

class FakeApplicationRepository {
  constructor(private readonly db: TestDb) {}

  async findOne({ where }: { where: Partial<Application> }) {
    return (
      this.db.applications.find((application) => {
        if (where.clientId && application.clientId !== where.clientId) return false;
        if (where.isActive !== undefined && application.isActive !== where.isActive) return false;
        return true;
      }) ?? null
    );
  }

  createQueryBuilder() {
    return new FakeApplicationQueryBuilder(this.db);
  }
}

function pkceChallenge(codeVerifier = CODE_VERIFIER) {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function validAuthorizeParams(overrides: Partial<AuthorizeParamsDto> = {}): AuthorizeParamsDto {
  return {
    clientId: 'gaceta',
    redirectUri: 'http://gaceta.local/callback',
    responseType: 'code',
    state: 'state-123',
    codeChallenge: pkceChallenge(),
    codeChallengeMethod: 'S256',
    ...overrides,
  };
}

function validationHas(errors: Awaited<ReturnType<typeof validate>>, property: string) {
  return errors.some((error) => error.property === property);
}

function createRedirectResponse() {
  const response = {
    cookies: new Map<string, string>(),
    redirectedTo: undefined as string | undefined,
    cookie: jest.fn((name: string, value: string) => response.cookies.set(name, value)),
    clearCookie: jest.fn((name: string) => response.cookies.delete(name)),
    redirect: jest.fn((url: string) => {
      response.redirectedTo = url;
      return url;
    }),
  };
  return response;
}

describe('Identity Hub OAuth/SSO integration', () => {
  let tempDir: string;
  let privateKey: string;
  let publicKey: string;
  let publicKeyConfigPath: string;
  let db: TestDb;
  let redis: InMemoryRedis;
  let authService: AuthService;
  let oauthService: OAuthService;
  let tokenService: TokenService;
  let oauthController: OAuthController;
  let jwksService: JwksService;
  let usersDirectoryService: UsersDirectoryService;
  let applicationClientAuthGuard: ApplicationClientAuthGuard;

  beforeAll(() => {
    const keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    tempDir = mkdtempSync(join(process.cwd(), '.identity-hub-test-'));
    privateKey = join(tempDir, 'private.pem');
    publicKey = join(tempDir, 'public.pem');
    publicKeyConfigPath = relative(process.cwd(), publicKey);
    writeFileSync(privateKey, keys.privateKey);
    writeFileSync(publicKey, keys.publicKey);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    db = {
      applications: [
        {
          id: 1,
          clientId: 'gaceta',
          name: 'Gaceta',
          launchUrl: 'http://gaceta.local',
          clientSecretHash: await hash('gaceta-secret', 10),
          isConfidential: true,
          redirectUris: ['http://gaceta.local/callback'],
          isActive: true,
        },
        {
          id: 2,
          clientId: 'intranet',
          name: 'Intranet',
          launchUrl: 'http://intranet.local',
          clientSecretHash: await hash('intranet-secret', 10),
          isConfidential: true,
          redirectUris: ['http://intranet.local/callback'],
          isActive: true,
        },
        {
          id: 3,
          clientId: 'disabled-app',
          name: 'Disabled',
          launchUrl: 'http://disabled.local',
          clientSecretHash: await hash('disabled-secret', 10),
          isConfidential: true,
          redirectUris: ['http://disabled.local/callback'],
          isActive: false,
        },
      ],
      users: [
        {
          id: 'user-1',
          login: 'active-user',
          password: await hash('password', 12),
          fullName: 'Active User',
          externalKey: 'IDH-U-ACTIVE',
          email: 'active@example.test',
          isActive: true,
          mustChangePassword: false,
          roles: [UserRole.USER],
          applicationIds: [1],
        },
        {
          id: 'user-2',
          login: 'inactive-user',
          password: await hash('password', 12),
          fullName: 'Inactive User',
          externalKey: 'IDH-U-INACTIVE',
          isActive: false,
          mustChangePassword: false,
          roles: [UserRole.USER],
          applicationIds: [1],
        },
        {
          id: 'user-3',
          login: 'no-access-user',
          password: await hash('password', 12),
          fullName: 'No Access User',
          externalKey: 'IDH-U-NOACCESS',
          isActive: true,
          mustChangePassword: false,
          roles: [UserRole.USER],
          applicationIds: [],
        },
      ],
    };

    redis = new InMemoryRedis();
    const userRepository = new FakeUserRepository(db);
    const applicationRepository = new FakeApplicationRepository(db);
    const jwtService = new JwtService({
      privateKey: readFile(privateKey),
      publicKey: readFile(publicKey),
      signOptions: {
        algorithm: 'RS256',
        keyid: OAUTH_JWT_KEY_ID,
        issuer: 'identity-hub-test',
      },
    });
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          IDENTITY_HUB_UI_BASE_URL: 'http://identity.local',
          IDENTITY_COOKIE_SECURE: false,
          JWT_PUBLIC_KEY_PATH: publicKeyConfigPath,
        };
        return values[key];
      }),
    };

    tokenService = new TokenService(redis as any, jwtService);
    authService = new AuthService(redis as any, userRepository as any, tokenService);
    oauthService = new OAuthService(
      applicationRepository as any,
      userRepository as any,
      redis as any,
      configService as any,
      tokenService,
      authService,
      new PkceService(),
    );
    oauthController = new OAuthController(oauthService, configService as any);
    jwksService = new JwksService(configService as any);
    usersDirectoryService = new UsersDirectoryService(userRepository as any);
    applicationClientAuthGuard = new ApplicationClientAuthGuard(
      new ApplicationClientAuthService(applicationRepository as any),
    );
  });

  describe('authorize/login', () => {
    it('starts a pending OAuth flow when the user has no session and preserves it after login', async () => {
      const loginRedirect = await oauthService.handleAuthorizeRequest(validAuthorizeParams(), undefined);
      const authRequestId = new URL(loginRedirect).searchParams.get('auth_request_id');
      expect(new URL(loginRedirect).origin + new URL(loginRedirect).pathname).toBe('http://identity.local/login');
      expect(authRequestId).toBeTruthy();

      const response = createRedirectResponse();
      await oauthController.login(
        { login: 'active-user', password: 'password' },
        { authRequestId: authRequestId! },
        response as any,
      );

      const sessionId = response.cookies.get(SESSION_COOKIE_NAME);
      expect(sessionId).toBeTruthy();
      expect(response.redirectedTo).toContain('/oauth/authorize?');
      expect(response.redirectedTo).toContain('state=state-123');

      const callbackUrl = await oauthService.handleAuthorizeRequest(validAuthorizeParams(), sessionId);
      const callback = new URL(callbackUrl);
      expect(callback.origin + callback.pathname).toBe('http://gaceta.local/callback');
      expect(callback.searchParams.get('code')).toBeTruthy();
      expect(callback.searchParams.get('state')).toBe('state-123');
    });

    it('rejects inactive users during login', async () => {
      const response = createRedirectResponse();
      await oauthController.login({ login: 'inactive-user', password: 'password' }, {}, response as any);

      expect(response.redirectedTo).toBe(`http://identity.local/login?error=${AuthErrorCode.USER_DISABLED}`);
    });

    it('does not issue an authorization code when the user has no access to the application', async () => {
      const sessionId = await authService.createAuthSession(db.users[2] as User);
      const redirectUrl = await oauthService.handleAuthorizeRequest(validAuthorizeParams(), sessionId);
      const url = new URL(redirectUrl);

      expect(url.origin + url.pathname).toBe('http://gaceta.local/callback');
      expect(url.searchParams.get('error')).toBe('access_denied');
      expect(url.searchParams.get('state')).toBe('state-123');
      expect(url.searchParams.get('code')).toBeNull();
    });

    it('does not start a flow for an inactive application', async () => {
      const redirectUrl = await oauthService.handleAuthorizeRequest(
        validAuthorizeParams({ clientId: 'disabled-app', redirectUri: 'http://disabled.local/callback' }),
        undefined,
      );

      expect(redirectUrl).toBe('http://identity.local/auth/error?error=invalid_client');
    });
  });

  describe('OAuth validation', () => {
    it('never redirects to an unregistered redirect_uri', async () => {
      const redirectUrl = await oauthService.handleAuthorizeRequest(
        validAuthorizeParams({ redirectUri: 'http://evil.local/callback' }),
        undefined,
      );

      expect(redirectUrl).toBe('http://identity.local/auth/error?error=invalid_redirect_uri');
      expect(redirectUrl).not.toContain('evil.local');
    });

    it('rejects missing state, non-code response_type, invalid scope and missing PKCE challenge at validation level', async () => {
      const missingState = plainToInstance(AuthorizeParamsDto, {
        client_id: 'gaceta',
        redirect_uri: 'http://gaceta.local/callback',
        response_type: 'code',
        code_challenge: pkceChallenge(),
        code_challenge_method: 'S256',
      });
      const invalidResponseType = plainToInstance(AuthorizeParamsDto, {
        client_id: 'gaceta',
        redirect_uri: 'http://gaceta.local/callback',
        response_type: 'token',
        state: 'state-123',
        code_challenge: pkceChallenge(),
        code_challenge_method: 'S256',
      });
      const invalidScope = plainToInstance(AuthorizeParamsDto, {
        client_id: 'gaceta',
        redirect_uri: 'http://gaceta.local/callback',
        response_type: 'code',
        state: 'state-123',
        scope: 'read',
        code_challenge: pkceChallenge(),
        code_challenge_method: 'S256',
      });
      const missingChallenge = plainToInstance(AuthorizeParamsDto, {
        client_id: 'gaceta',
        redirect_uri: 'http://gaceta.local/callback',
        response_type: 'code',
        state: 'state-123',
        code_challenge_method: 'S256',
      });
      const plainPkce = plainToInstance(AuthorizeParamsDto, {
        client_id: 'gaceta',
        redirect_uri: 'http://gaceta.local/callback',
        response_type: 'code',
        state: 'state-123',
        code_challenge: pkceChallenge(),
        code_challenge_method: 'plain',
      });

      expect(validationHas(await validate(missingState), 'state')).toBe(true);
      expect(validationHas(await validate(invalidResponseType), 'responseType')).toBe(true);
      expect(validationHas(await validate(invalidScope), 'scope')).toBe(true);
      expect(validationHas(await validate(missingChallenge), 'codeChallenge')).toBe(true);
      expect(validationHas(await validate(plainPkce), 'codeChallengeMethod')).toBe(true);
    });

    it('fails invalid client_id without redirecting to a client callback', async () => {
      const redirectUrl = await oauthService.handleAuthorizeRequest(
        validAuthorizeParams({ clientId: 'unknown' }),
        undefined,
      );

      expect(redirectUrl).toBe('http://identity.local/auth/error?error=invalid_client');
    });
  });

  describe('authorization code, PKCE and tokens', () => {
    async function issueCode(params = validAuthorizeParams()) {
      const sessionId = await authService.createAuthSession(db.users[0] as User);
      const redirectUrl = await oauthService.handleAuthorizeRequest(params, sessionId);
      return new URL(redirectUrl).searchParams.get('code')!;
    }

    async function exchangeCode(code: string, overrides: Partial<TokenRequestDto> = {}) {
      return oauthService.handleTokenRequest({
        grantType: GrantType.AUTHORIZATION_CODE,
        clientId: 'gaceta',
        clientSecret: 'gaceta-secret',
        code,
        redirectUri: 'http://gaceta.local/callback',
        codeVerifier: CODE_VERIFIER,
        ...overrides,
      });
    }

    it('exchanges a valid authorization code once and rejects reuse', async () => {
      const code = await issueCode();
      const tokenPair = await exchangeCode(code);

      expect(tokenPair.accessToken).toBeTruthy();
      expect(tokenPair.refreshToken).toBeTruthy();
      await expect(exchangeCode(code)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects expired codes, wrong redirect_uri, wrong clientId and wrong PKCE verifier', async () => {
      const expiredCode = await issueCode();
      redis.expireNow(`auth_code:${expiredCode}`);
      await expect(exchangeCode(expiredCode)).rejects.toBeInstanceOf(UnauthorizedException);

      await expect(
        exchangeCode(await issueCode(), { redirectUri: 'http://gaceta.local/other' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        exchangeCode(await issueCode(), {
          clientId: 'intranet',
          clientSecret: 'intranet-secret',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        exchangeCode(await issueCode(), { codeVerifier: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('requires code_verifier at validation level for authorization_code grant', async () => {
      const request = plainToInstance(TokenRequestDto, {
        grant_type: 'authorization_code',
        client_id: 'gaceta',
        client_secret: 'gaceta-secret',
        code: 'code',
        redirect_uri: 'http://gaceta.local/callback',
      });

      expect(validationHas(await validate(request), 'codeVerifier')).toBe(true);
    });

    it('emits RS256 access tokens with expected issuer, audience, subject and expiration', async () => {
      const tokenPair = await exchangeCode(await issueCode());
      const jwtService = new JwtService();
      const header = jwtService.decode(tokenPair.accessToken, { complete: true })?.header;
      const payload = await jwtService.verifyAsync(tokenPair.accessToken, {
        publicKey: readFile(publicKey),
        algorithms: ['RS256'],
        issuer: 'identity-hub-test',
        audience: 'gaceta',
      });

      expect(header).toMatchObject({ alg: 'RS256', kid: OAUTH_JWT_KEY_ID });
      expect(payload).toMatchObject({
        iss: 'identity-hub-test',
        aud: 'gaceta',
        sub: 'user-1',
      });
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('exposes JWKS with the public key kid', () => {
      expect(jwksService.getJwks()).toEqual({
        keys: [expect.objectContaining({ kid: OAUTH_JWT_KEY_ID, alg: 'RS256', use: 'sig' })],
      });
    });

    it('rotates refresh tokens, rejects old/invalid tokens and enforces client binding', async () => {
      const initial = await exchangeCode(await issueCode());
      const rotated = await oauthService.handleTokenRequest({
        grantType: GrantType.REFRESH_TOKEN,
        clientId: 'gaceta',
        clientSecret: 'gaceta-secret',
        refreshToken: initial.refreshToken,
      });

      expect(rotated.accessToken).toBeTruthy();
      expect(rotated.refreshToken).not.toBe(initial.refreshToken);
      await expect(
        oauthService.handleTokenRequest({
          grantType: GrantType.REFRESH_TOKEN,
          clientId: 'gaceta',
          clientSecret: 'gaceta-secret',
          refreshToken: initial.refreshToken,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        oauthService.handleTokenRequest({
          grantType: GrantType.REFRESH_TOKEN,
          clientId: 'gaceta',
          clientSecret: 'gaceta-secret',
          refreshToken: 'invalid-refresh',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const otherClientInitial = await exchangeCode(await issueCode());
      await expect(
        oauthService.handleTokenRequest({
          grantType: GrantType.REFRESH_TOKEN,
          clientId: 'intranet',
          clientSecret: 'intranet-secret',
          refreshToken: otherClientInitial.refreshToken,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('logout removes the session, revokes refresh tokens and forces login on next authorize', async () => {
      const sessionId = await authService.createAuthSession(db.users[0] as User);
      const code = new URL(
        await oauthService.handleAuthorizeRequest(validAuthorizeParams(), sessionId),
      ).searchParams.get('code')!;
      const tokenPair = await exchangeCode(code);

      await authService.removeAuthSession(sessionId);

      await expect(
        oauthService.handleTokenRequest({
          grantType: GrantType.REFRESH_TOKEN,
          clientId: 'gaceta',
          clientSecret: 'gaceta-secret',
          refreshToken: tokenPair.refreshToken,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const redirectUrl = await oauthService.handleAuthorizeRequest(validAuthorizeParams(), sessionId);
      expect(new URL(redirectUrl).origin + new URL(redirectUrl).pathname).toBe('http://identity.local/login');
    });
  });

  describe('internal endpoints', () => {
    function contextForAuthorization(authorization?: string) {
      const request: Record<string, unknown> = {
        headers: { authorization },
      };
      return {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        request,
      };
    }

    it('rejects missing, invalid and inactive Basic Auth credentials', async () => {
      await expect(applicationClientAuthGuard.canActivate(contextForAuthorization() as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(
        applicationClientAuthGuard.canActivate(
          contextForAuthorization(`Basic ${Buffer.from('gaceta:wrong').toString('base64')}`) as any,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        applicationClientAuthGuard.canActivate(
          contextForAuthorization(`Basic ${Buffer.from('disabled-app:disabled-secret').toString('base64')}`) as any,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('authenticates valid Basic Auth credentials and returns only safe assignable user fields', async () => {
      const context = contextForAuthorization(`Basic ${Buffer.from('gaceta:gaceta-secret').toString('base64')}`);
      await expect(applicationClientAuthGuard.canActivate(context as any)).resolves.toBe(true);
      expect((context.request as any).application).toMatchObject({ clientId: 'gaceta' });

      const users = await usersDirectoryService.findAssignableUsers(1, {});
      expect(users).toEqual([
        {
          externalKey: 'IDH-U-ACTIVE',
          fullName: 'Active User',
          email: 'active@example.test',
          login: 'active-user',
        },
      ]);
      expect(Object.keys(users[0]).sort()).toEqual(['email', 'externalKey', 'fullName', 'login']);
      expect(users[0]).not.toHaveProperty('password');
      expect(users[0]).not.toHaveProperty('roles');
      expect(users[0]).not.toHaveProperty('clientSecretHash');
    });
  });
});

function readFile(path: string): string {
  return readFileSync(path, 'utf8');
}
