import { config } from 'dotenv';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { isEmail } from 'class-validator';
import Redis from 'ioredis';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { Application } from '../src/modules/access/entities';
import { UserApplicationsService } from '../src/modules/access/services';
import { UserProvisioningService } from '../src/modules/provisioning/services';
import { User } from '../src/modules/users/entities';
import { UsersService } from '../src/modules/users/services';

const APPLICATION_CLIENT_ID = 'seg-tramites';
const INPUT_PATH = resolve(process.cwd(), 'migration-data/seguimiento-identity-users.json');
const OUTPUT_PATH = resolve(process.cwd(), 'migration-data/seguimiento-identity-mapping.json');
const UNRESOLVED_OUTPUT_PATH = resolve(process.cwd(), 'migration-data/seguimiento-identity-unresolved.json');
const RRHH_TIMEOUT_MS = 10_000;

interface Candidate {
  userId: string;
  login: string | null;
  email: string | null;
  fullName: string;
  relationKey: string;
  passwordHash?: string | null;
  updatedPassword?: boolean;
}

interface Unresolved {
  accountId?: string;
  userId?: string;
  reason: string;
}

interface MigrationInput {
  candidates: Candidate[];
  unresolved?: Unresolved[];
}

interface Mapping {
  userId: string;
  externalKey: string;
  relationKey: string;
}

interface MigrationOutput {
  mappings: Mapping[];
  unresolved: Unresolved[];
}

interface DiagnosticUnresolved {
  userId?: string;
  login: string | null;
  relationKey: string | null;
  email?: string;
  reason: string;
}

interface RrhhActiveEmployee {
  relationKey: string;
  ci: number | string;
  fullName: string;
}

interface DryRunState {
  plannedEmails: Map<string, string>;
  plannedLogins: Map<string, string>;
  plannedRelationKeys: Set<string>;
}

class CandidateUnresolvedError extends Error {
  constructor(
    message: string,
    readonly includeEmail = false,
  ) {
    super(message);
  }
}

function getMode(): 'dry-run' | 'apply' {
  const modes = process.argv.slice(2);
  if (modes.length !== 1 || !['--dry-run', '--apply'].includes(modes[0])) {
    throw new Error('Use exactly one mode: --dry-run or --apply');
  }
  return modes[0] === '--apply' ? 'apply' : 'dry-run';
}

function getRequiredEnv(name: 'RRHH_INTERNAL_URL' | 'RRHH_ACCESS_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function normalizeOptionalEmail(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  return value.trim().toLowerCase() || null;
}

function parseRelationKey(value: string, field: string): { ci: string; extension: string | null; normalized: string } {
  const match = /^(\d+)(?:\s*-\s*([A-Z0-9]+))?$/.exec(value.trim().toUpperCase());
  if (!match) throw new Error(`Invalid ${field}`);

  const ci = match[1].replace(/^0+(?=\d)/, '');
  const extension = match[2] ?? null;
  return { ci, extension, normalized: extension ? `${ci}-${extension}` : ci };
}

const BCRYPT_HASH = /^\$2[ab]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

export function parseInput(raw: string): MigrationInput {
  let parsed: Partial<MigrationInput> | null;
  try {
    parsed = JSON.parse(raw) as Partial<MigrationInput> | null;
  } catch {
    // SyntaxError messages can quote the JSON, including password hashes.
    throw new Error('Invalid migration JSON');
  }
  if (!parsed || !Array.isArray(parsed.candidates)) {
    throw new Error('Input must contain a candidates array');
  }
  if (parsed.unresolved !== undefined && !Array.isArray(parsed.unresolved)) {
    throw new Error('Input unresolved must be an array');
  }

  const candidates = parsed.candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`Invalid candidate at index ${index}`);
    }
    if (candidate.updatedPassword !== undefined && typeof candidate.updatedPassword !== 'boolean') {
      throw new Error(`Invalid candidates[${index}].updatedPassword`);
    }
    if (
      candidate.passwordHash !== undefined &&
      candidate.passwordHash !== null &&
      (typeof candidate.passwordHash !== 'string' || !BCRYPT_HASH.test(candidate.passwordHash))
    ) {
      throw new Error(`Invalid candidates[${index}].passwordHash`);
    }

    return {
      userId: requireNonEmptyString(candidate.userId, `candidates[${index}].userId`),
      login:
        candidate.login === null ? null : requireNonEmptyString(candidate.login, `candidates[${index}].login`).trim(),
      email: normalizeOptionalEmail(candidate.email, `candidates[${index}].email`),
      fullName: requireNonEmptyString(candidate.fullName, `candidates[${index}].fullName`).trim(),
      relationKey: requireNonEmptyString(candidate.relationKey, `candidates[${index}].relationKey`).trim(),
      passwordHash: candidate.updatedPassword === true ? (candidate.passwordHash ?? null) : null,
      updatedPassword: candidate.updatedPassword === true,
    };
  });

  const unresolved = (parsed.unresolved ?? []).map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid unresolved item at index ${index}`);
    }
    return {
      ...(item.accountId !== undefined && {
        accountId: requireNonEmptyString(item.accountId, `unresolved[${index}].accountId`),
      }),
      ...(item.userId !== undefined && {
        userId: requireNonEmptyString(item.userId, `unresolved[${index}].userId`),
      }),
      reason: requireNonEmptyString(item.reason, `unresolved[${index}].reason`),
    };
  });

  return { candidates, unresolved };
}

async function findActiveEmployee(relationKey: string): Promise<RrhhActiveEmployee> {
  const baseUrl = getRequiredEnv('RRHH_INTERNAL_URL');
  const url = new URL(
    `internal/employees/${encodeURIComponent(relationKey)}`,
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'x-access-code': getRequiredEnv('RRHH_ACCESS_TOKEN') },
      signal: AbortSignal.timeout(RRHH_TIMEOUT_MS),
    });
  } catch {
    throw new Error('RRHH is temporarily unavailable');
  }

  if ([400, 404, 409].includes(response.status)) {
    const reasons: Record<number, string> = {
      400: 'relationKey rechazado por RRHH',
      404: 'funcionario no activo o no encontrado en RRHH',
      409: 'relationKey ambiguo en RRHH',
    };
    throw new CandidateUnresolvedError(reasons[response.status]);
  }
  if (!response.ok) {
    throw new Error(`RRHH is temporarily unavailable (HTTP ${response.status})`);
  }

  const employee = (await response.json()) as Partial<RrhhActiveEmployee>;
  const authoritativeRelationKey = requireNonEmptyString(employee.relationKey, 'RRHH relationKey').trim();
  const fullName = requireNonEmptyString(employee.fullName, 'RRHH fullName').trim();
  const requested = parseRelationKey(relationKey, 'candidate relationKey');
  const authoritative = parseRelationKey(authoritativeRelationKey, 'RRHH relationKey');
  const employeeCi = parseRelationKey(String(employee.ci), 'RRHH ci').ci;

  if (requested.ci !== employeeCi || authoritative.ci !== employeeCi) {
    throw new CandidateUnresolvedError('relationKey inconsistente con RRHH');
  }
  if (requested.extension && requested.normalized !== authoritative.normalized) {
    throw new CandidateUnresolvedError('relationKey inconsistente con RRHH');
  }

  return { relationKey: authoritative.normalized, ci: employee.ci!, fullName };
}

async function findUsersByRelationKey(repository: Repository<User>, relationKey: string): Promise<User[]> {
  return repository.find({ where: { relationKey }, relations: { applications: true } });
}

async function assertLoginAvailable(
  repository: Repository<User>,
  candidate: Candidate,
  authoritativeRelationKey: string,
  hasRelationUser: boolean,
): Promise<void> {
  if (!candidate.login) {
    if (!hasRelationUser) throw new CandidateUnresolvedError('candidato sin login');
    return;
  }

  const loginUser = await repository.findOne({ where: { login: candidate.login } });
  if (loginUser && loginUser.relationKey !== authoritativeRelationKey) {
    throw new CandidateUnresolvedError('login ocupado por otro User');
  }
}

async function resolveEmailForNewUser(
  repository: Repository<User>,
  candidate: Candidate,
  authoritativeRelationKey: string,
  dryRunState: DryRunState,
): Promise<string | null> {
  if (!candidate.email) return null;
  if (!isEmail(candidate.email)) {
    throw new CandidateUnresolvedError('email legacy inválido', true);
  }

  const emailUser = await repository
    .createQueryBuilder('user')
    .where('LOWER(user.email) = :email', { email: candidate.email })
    .getOne();
  const plannedRelationKey = dryRunState.plannedEmails.get(candidate.email);
  if (emailUser || (plannedRelationKey && plannedRelationKey !== authoritativeRelationKey)) {
    throw new CandidateUnresolvedError('email ocupado por otro User', true);
  }

  return candidate.email;
}

async function addApplicationWithoutRemovingOthers(
  dataSource: DataSource,
  userApplicationsService: UserApplicationsService,
  usersService: UsersService,
  user: User,
  employee: RrhhActiveEmployee,
  applicationId: number,
): Promise<User> {
  return dataSource.transaction(async (manager) => {
    await usersService.update(user.id, { fullName: employee.fullName, relationKey: employee.relationKey }, manager);
    const current = await usersService.findOneWithApplications(user.id, manager);
    await userApplicationsService.syncApplications(
      user.id,
      [...current.applications.map((application) => application.id), applicationId],
      manager,
    );
    return usersService.findOneWithApplications(user.id, manager);
  });
}

export async function processCandidate(
  candidate: Candidate,
  apply: boolean,
  application: Application,
  userRepository: Repository<User>,
  dataSource: DataSource,
  usersService: UsersService,
  userApplicationsService: UserApplicationsService,
  userProvisioningService: UserProvisioningService,
  dryRunState: DryRunState,
): Promise<Mapping | null> {
  const employee = await findActiveEmployee(candidate.relationKey);
  const relationUsers = await findUsersByRelationKey(userRepository, employee.relationKey);
  if (relationUsers.length > 1) {
    throw new CandidateUnresolvedError('múltiples Users con el mismo relationKey');
  }

  const relationUser = relationUsers[0];
  const plannedRelationUser = !apply && dryRunState.plannedRelationKeys.has(employee.relationKey);
  await assertLoginAvailable(
    userRepository,
    candidate,
    employee.relationKey,
    Boolean(relationUser) || plannedRelationUser,
  );
  const email =
    relationUser || plannedRelationUser
      ? null
      : await resolveEmailForNewUser(userRepository, candidate, employee.relationKey, dryRunState);

  if (candidate.login) {
    const plannedRelationKey = dryRunState.plannedLogins.get(candidate.login);
    if (plannedRelationKey && plannedRelationKey !== employee.relationKey) {
      throw new CandidateUnresolvedError('login ocupado por otro User');
    }
  }

  if (!apply) {
    if (!relationUser && !plannedRelationUser) {
      dryRunState.plannedRelationKeys.add(employee.relationKey);
      dryRunState.plannedLogins.set(candidate.login!, employee.relationKey);
      if (email) dryRunState.plannedEmails.set(email, employee.relationKey);
    }
    return null;
  }

  const user = relationUser
    ? await addApplicationWithoutRemovingOthers(
        dataSource,
        userApplicationsService,
        usersService,
        relationUser,
        employee,
        application.id,
      )
    : (
        await userProvisioningService.provisionUserWithApplicationsWithoutNotification(
          {
            fullName: employee.fullName,
            login: candidate.login!,
            relationKey: employee.relationKey,
            email,
            applicationIds: [application.id],
          },
          candidate.passwordHash ?? undefined,
        )
      ).user;

  return { userId: candidate.userId, externalKey: user.externalKey, relationKey: employee.relationKey };
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryDirectory = await mkdtemp(resolve(directory, '.identity-import-'));
  try {
    const temporaryPath = resolve(temporaryDirectory, 'data.json');
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  process.umask(0o077);
  config();
  const mode = getMode();
  getRequiredEnv('RRHH_INTERNAL_URL');
  getRequiredEnv('RRHH_ACCESS_TOKEN');

  // Also protect exports copied into an already-existing destination file.
  await chmod(dirname(INPUT_PATH), 0o700);
  await chmod(INPUT_PATH, 0o600);
  const input = parseInput(await readFile(INPUT_PATH, 'utf8'));
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const dataSource = context.get(DataSource);
    const application = await dataSource.getRepository(Application).findOne({
      where: { clientId: APPLICATION_CLIENT_ID, isActive: true },
    });
    if (!application) {
      throw new Error(`Active Application ${APPLICATION_CLIENT_ID} was not found`);
    }

    const userRepository = dataSource.getRepository(User);
    const usersService = context.get(UsersService);
    const userApplicationsService = context.get(UserApplicationsService);
    const userProvisioningService = context.get(UserProvisioningService);
    const output: MigrationOutput = { mappings: [], unresolved: [...(input.unresolved ?? [])] };
    const diagnosticUnresolved: DiagnosticUnresolved[] = (input.unresolved ?? []).map(({ userId, reason }) => ({
      ...(userId && { userId }),
      login: null,
      relationKey: null,
      reason,
    }));
    const dryRunState: DryRunState = {
      plannedEmails: new Map(),
      plannedLogins: new Map(),
      plannedRelationKeys: new Set(),
    };

    for (const candidate of input.candidates) {
      try {
        const mapping = await processCandidate(
          candidate,
          mode === 'apply',
          application,
          userRepository,
          dataSource,
          usersService,
          userApplicationsService,
          userProvisioningService,
          dryRunState,
        );
        if (mapping) output.mappings.push(mapping);
      } catch (error: unknown) {
        if (!(error instanceof CandidateUnresolvedError)) throw error;
        output.unresolved.push({ userId: candidate.userId, reason: error.message });
        diagnosticUnresolved.push({
          userId: candidate.userId,
          login: candidate.login,
          relationKey: candidate.relationKey,
          ...(error.includeEmail && candidate.email ? { email: candidate.email } : {}),
          reason: error.message,
        });
      }
    }

    if (mode === 'dry-run') {
      await writeJson(UNRESOLVED_OUTPUT_PATH, { unresolved: diagnosticUnresolved });
      console.log(`Unresolved diagnostics written to ${UNRESOLVED_OUTPUT_PATH}`);
      return;
    }

    await writeJson(OUTPUT_PATH, output);
    console.log(`Mapping written to ${OUTPUT_PATH}`);
  } finally {
    context.get<Redis>(getRedisConnectionToken()).disconnect();
    await context.close();
  }
}

export function migrationErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || error instanceof QueryFailedError) {
    return 'Identity import failed; check database access and constraints (database details omitted).';
  }
  return error.message.replace(/\$2[abxy]\$[^\s"'`,;)}\]]*/g, '[REDACTED]');
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(migrationErrorMessage(error));
    process.exitCode = 1;
  });
}
