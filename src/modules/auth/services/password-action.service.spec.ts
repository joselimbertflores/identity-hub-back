import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

import { EnvironmentVariables } from 'src/config';
import { MailService } from 'src/modules/mail';
import { User } from 'src/modules/users/entities';
import { PasswordActionToken } from '../entities';
import { AuthService } from './auth.service';
import { PasswordActionService } from './password-action.service';

describe('PasswordActionService', () => {
  const user = {
    id: 'user-id',
    login: 'maria',
    fullName: 'María Pérez',
    email: 'maria@example.org',
    isActive: true,
    credentialVersion: 2,
  } as User;

  const configService = {
    get: jest.fn().mockReturnValue('https://siau.example'),
    getOrThrow: jest.fn().mockImplementation((key: keyof EnvironmentVariables) => {
      if (key === 'PASSWORD_ACTION_TTL_SECONDS') return 3600;
      return 'https://siau.example';
    }),
  } as unknown as ConfigService<EnvironmentVariables, true>;

  const revokeAllUserSessions = jest.fn().mockResolvedValue(undefined);
  const authService = { revokeAllUserSessions } as unknown as AuthService;

  const sendMail = jest.fn().mockResolvedValue(undefined);
  const mailService = { send: sendMail } as unknown as MailService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replaces the only token for an active user', async () => {
    const userQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(user),
    };
    const userRepository = { createQueryBuilder: jest.fn().mockReturnValue(userQuery) };
    let createdAction: { userId: string; tokenHash: string } | undefined;
    const actionRepository = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockImplementation((action: { userId: string; tokenHash: string }) => {
        createdAction = action;
        return action;
      }),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: jest.fn().mockImplementation((entity: unknown) =>
        entity === User ? userRepository : actionRepository,
      ),
    } as unknown as EntityManager;
    const service = new PasswordActionService({} as DataSource, configService, authService, mailService);

    const issued = await service.issueOrReplace(user.id, manager);

    expect(actionRepository.delete).toHaveBeenCalledWith({ userId: user.id });
    expect(createdAction?.userId).toBe(user.id);
    expect(createdAction?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.actionUrl).toMatch(/^https:\/\/siau\.example\/set-password\?code=/);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not invalidate credentials or sessions when recovery is requested', async () => {
    const publicActionRepository = { delete: jest.fn().mockResolvedValue(undefined) };
    const userQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([user]),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue({ createQueryBuilder: jest.fn().mockReturnValue(userQuery) }),
    } as unknown as EntityManager;
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(publicActionRepository),
      transaction: jest.fn().mockImplementation(async (callback: (value: EntityManager) => Promise<unknown>) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new PasswordActionService(dataSource, configService, authService, mailService);
    const action = {
      code: '23456-23456-23456-23456-23456-23456',
      actionUrl: 'https://siau.example/set-password',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const issueOrReplace = jest.spyOn(service, 'issueOrReplace').mockResolvedValue(action);
    const deliver = jest.spyOn(service, 'deliver').mockResolvedValue({
      method: 'EMAIL',
      status: 'SENT',
      expiresAt: action.expiresAt.toISOString(),
    });

    await service.requestRecovery(user.login);

    expect(issueOrReplace).toHaveBeenCalledWith(user.id, manager);
    expect(deliver).toHaveBeenCalledWith(user, action);
    expect(revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it('changes credentials, consumes the token and revokes sessions on completion', async () => {
    const code = '23456-23456-23456-23456-23456-23456';
    const tokenHash = createHash('sha256').update(code.replaceAll('-', ''), 'utf8').digest('hex');
    const action = {
      id: 'action-id',
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    } as PasswordActionToken;
    const publicActionRepository = {
      delete: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(action),
    };
    const userQuery = {
      addSelect: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ ...user }),
    };
    const actionQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(action),
    };
    const userRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(userQuery),
      save: jest.fn().mockImplementation((value: User) => Promise.resolve(value)),
    };
    const actionRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(actionQuery),
      remove: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: jest.fn().mockImplementation((entity: unknown) =>
        entity === User ? userRepository : actionRepository,
      ),
    } as unknown as EntityManager;
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(publicActionRepository),
      transaction: jest.fn().mockImplementation(async (callback: (value: EntityManager) => Promise<unknown>) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new PasswordActionService(dataSource, configService, authService, mailService);

    await expect(
      service.completePasswordAction({
        code,
        newPassword: 'new-password',
        passwordConfirmation: 'new-password',
      }),
    ).resolves.toEqual({ message: 'Password updated successfully. Sign in with your new password.' });

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ credentialVersion: user.credentialVersion + 1 }),
    );
    expect(actionRepository.delete).toHaveBeenCalledWith({ userId: user.id });
    expect(revokeAllUserSessions).toHaveBeenCalledWith(user.id);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
  });
});
