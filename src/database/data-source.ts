import 'reflect-metadata';
import 'tsconfig-paths/register';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

config();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: getRequiredEnv('DATABASE_HOST'),
  port: Number(getRequiredEnv('DATABASE_PORT')),
  database: getRequiredEnv('DATABASE_NAME'),
  username: getRequiredEnv('DATABASE_USER'),
  password: getRequiredEnv('DATABASE_PASSWORD'),
  entities: [join(__dirname, '../modules/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
});
