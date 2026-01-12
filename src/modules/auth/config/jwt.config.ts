import * as fs from 'fs';
import * as path from 'path';

const keysPath = path.join(process.cwd(), 'keys');

function readKey(filename: string): string {
  const fullPath = path.join(keysPath, filename);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`JWT key not found: ${fullPath}`);
  }

  return fs.readFileSync(fullPath, 'utf8');
}

export const jwtPrivateKey = readKey('private.pem');
export const jwtPublicKey = readKey('public.pem');
