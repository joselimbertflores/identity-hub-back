import Joi from 'joi';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type IdentityCookieSameSite = 'lax' | 'strict' | 'none';

export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  IDENTITY_HUB_PUBLIC_URL: string;
  IDENTITY_HUB_UI_URL: string;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_NAME: string;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_SYNCHRONIZE: boolean;
  REDIS_URL: string;
  JWT_PRIVATE_KEY_PATH: string;
  JWT_PUBLIC_KEY_PATH: string;
  PASSWORD_INITIAL_SETUP_TTL_SECONDS: number;
  PASSWORD_RESET_TTL_SECONDS: number;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_ADDRESS: string;
  SMTP_FROM_NAME: string;
  IDENTITY_COOKIE_SECURE: boolean;
  IDENTITY_COOKIE_SAME_SITE: IdentityCookieSameSite;
  BOOTSTRAP_ADMIN_LOGIN?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  BOOTSTRAP_ADMIN_FULL_NAME?: string;
}

const portSchema = Joi.number().integer().min(1).max(65535);
const httpUrlSchema = Joi.string().uri({ scheme: ['http', 'https'], allowRelative: false });

export const environmentValidationSchema: Joi.ObjectSchema<EnvironmentVariables> = Joi.object<EnvironmentVariables>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT: portSchema.required(),
  IDENTITY_HUB_PUBLIC_URL: httpUrlSchema.required(),
  IDENTITY_HUB_UI_URL: httpUrlSchema.required(),
  DATABASE_HOST: Joi.string().trim().min(1).required(),
  DATABASE_PORT: portSchema.required(),
  DATABASE_NAME: Joi.string().trim().min(1).required(),
  DATABASE_USER: Joi.string().trim().min(1).required(),
  DATABASE_PASSWORD: Joi.string().min(1).required(),
  DATABASE_SYNCHRONIZE: Joi.boolean()
    .when('NODE_ENV', { is: 'production', then: Joi.valid(false) })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'], allowRelative: false })
    .required(),
  JWT_PRIVATE_KEY_PATH: Joi.string().min(1).required(),
  JWT_PUBLIC_KEY_PATH: Joi.string().min(1).required(),
  PASSWORD_INITIAL_SETUP_TTL_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(24 * 60 * 60),
  PASSWORD_RESET_TTL_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(60 * 60),
  SMTP_HOST: Joi.string().trim().min(1).required(),
  SMTP_PORT: portSchema.required(),
  SMTP_SECURE: Joi.boolean().required(),
  SMTP_USERNAME: Joi.string().trim().min(1).optional(),
  SMTP_PASSWORD: Joi.string().min(1).optional(),
  SMTP_FROM_ADDRESS: Joi.string().email().required(),
  SMTP_FROM_NAME: Joi.string().trim().min(1).required(),
  IDENTITY_COOKIE_SECURE: Joi.boolean().required(),
  IDENTITY_COOKIE_SAME_SITE: Joi.string()
    .valid('lax', 'strict', 'none')
    .when('IDENTITY_COOKIE_SECURE', { is: false, then: Joi.invalid('none') })
    .required(),
  BOOTSTRAP_ADMIN_LOGIN: Joi.string().trim().min(1).optional(),
  BOOTSTRAP_ADMIN_PASSWORD: Joi.string().min(1).optional(),
  BOOTSTRAP_ADMIN_FULL_NAME: Joi.string().trim().min(1).optional(),
}).and('SMTP_USERNAME', 'SMTP_PASSWORD');
