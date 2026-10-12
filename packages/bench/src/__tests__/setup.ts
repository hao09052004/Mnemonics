/**
 * Test bootstrap for the bench package.
 *
 * Mirrors `packages/database/src/__tests__/setup.ts` so
 * the integration tests run against the same Postgres the
 * dev environment uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const explicit = process.env.DATABASE_URL;
const fromRootEnv = readEnvFile(join(process.cwd(), '..', '..', '.env')).DATABASE_URL;
const fromLocalEnv = readEnvFile(join(process.cwd(), '.env')).DATABASE_URL;

export const DATABASE_URL = explicit || fromRootEnv || fromLocalEnv ||
  'postgresql://mnemonics:mnemonics@localhost:5432/mnemonics';

export const USING_FALLBACK_DATABASE = !(explicit || fromRootEnv || fromLocalEnv);
