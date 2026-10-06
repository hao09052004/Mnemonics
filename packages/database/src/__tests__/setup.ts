/**
 * Test bootstrap for the database package.
 *
 * Every spec under `src/__tests__` is an integration test that needs a
 * real Postgres. Rather than let each spec fail with a wall of
 * connection errors on a machine without one, resolve the connection
 * string here — preferring an explicit DATABASE_URL, then the
 * repo-root .env the demo uses — and export a single value the specs
 * share.
 *
 * The specs import `DATABASE_URL` from this module instead of reading
 * `process.env` themselves, so there is exactly one place that decides
 * which database the suite runs against.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal .env reader — avoids adding dotenv as a dependency here. */
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

/** False when the string above came from a real .env / environment. */
export const USING_FALLBACK_DATABASE = !(explicit || fromRootEnv || fromLocalEnv);
