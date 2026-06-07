import { config } from 'dotenv';
import * as bcrypt from 'bcrypt';
import { ArrayContains, Repository } from 'typeorm';
import { ulid } from 'ulid';

import { AppDataSource } from '../src/database/data-source';
import { User, UserRole } from '../src/modules/users/entities';

config();

function getRequiredBootstrapEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required bootstrap environment variable: ${name}`);
  }
  return value;
}

async function bootstrapFirstAdmin(userRepository: Repository<User>): Promise<void> {
  const hasAdmin = await userRepository.exists({
    where: { roles: ArrayContains([UserRole.ADMIN]) },
  });

  if (hasAdmin) {
    console.log('Bootstrap skipped: an admin user already exists.');
    return;
  }

  const login = getRequiredBootstrapEnv('BOOTSTRAP_ADMIN_LOGIN');
  const password = getRequiredBootstrapEnv('BOOTSTRAP_ADMIN_PASSWORD');
  const fullName = getRequiredBootstrapEnv('BOOTSTRAP_ADMIN_FULL_NAME');

  const existingUser = await userRepository.findOne({ where: { login } });
  if (existingUser) {
    throw new Error('Bootstrap admin login already exists. Refusing to promote an existing user automatically.');
  }

  const user = userRepository.create({
    login,
    fullName,
    password: await bcrypt.hash(password, 12),
    externalKey: `IDH-U-${ulid()}`,
    roles: [UserRole.USER, UserRole.ADMIN],
    isActive: true,
    mustChangePassword: true,
  });

  await userRepository.save(user);
  console.log('Bootstrap admin created.');
}

async function runBootstrap() {
  await AppDataSource.initialize();

  try {
    await bootstrapFirstAdmin(AppDataSource.getRepository(User));
  } finally {
    await AppDataSource.destroy();
  }
}

void runBootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
