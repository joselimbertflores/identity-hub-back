import * as fs from 'fs';
import * as path from 'path';

export function readJwtKey(keyPath: string): string {
  const fullPath = path.resolve(process.cwd(), keyPath);

  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read JWT key: ${fullPath}`, { cause: error });
  }
}
