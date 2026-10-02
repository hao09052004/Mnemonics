/**
 * Apply a single migration to the Supabase database. Replaces the older
 * apply-migration.mts which depended on `pg` being a direct dep of @mnemonics/api.
 *
 * Usage: node --experimental-strip-types apps/api/scripts/apply-migration.mts <file>
 *
 * Reads `DATABASE_URL` from .env (current working dir first, then repo root),
 * prints the result, and exits non-zero if it fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createPool } from '@mnemonics/database';

const cwdEnv = resolve(process.cwd(), '.env');
const rootEnv = resolve(process.cwd(), '..', '..', '.env');
config({ path: cwdEnv });
if (!process.env.DATABASE_URL && (await import('node:fs')).existsSync(rootEnv)) {
  config({ path: rootEnv });
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set; check your .env');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: apply-migration.mts <path/to/migration.sql>');
  process.exit(1);
}

const sql = readFileSync(resolve(file), 'utf8');
const pool = createPool(url);

async function main() {
  console.log(`Applying migration from ${file} (${sql.length} bytes)`);
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('OK');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
