import * as fs from 'fs';
import * as path from 'path';

export function readJwtKey(keyPath: string): string {
  const fullPath = path.join(process.cwd(), keyPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`JWT key not found: ${fullPath}`);
  }

  return fs.readFileSync(fullPath, 'utf8');
}
