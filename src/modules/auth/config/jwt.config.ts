import * as fs from 'fs';
import * as path from 'path';

function readKey(keyPath: string): string {
  const fullPath = path.join(process.cwd(), keyPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`JWT key not found: ${fullPath}`);
  }

  return fs.readFileSync(fullPath, 'utf8');
}

export const jwtPrivateKey = readKey(process.env.JWT_PRIVATE_KEY_PATH ?? 'keys/private.pem');

export const jwtPublicKey = readKey(process.env.JWT_PUBLIC_KEY_PATH ?? 'keys/public.pem');
