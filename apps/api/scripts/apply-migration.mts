/**
 * Apply a single migration to the Supabase database.
 *
 * Usage: node --experimental-strip-types apps/api/scripts/apply-migration.mts <file>
 *
 * Reads `DATABASE_URL` from .env, prints each statement as it runs, and
 * exits non-zero if any statement fails. Intended for the human to run
 * by hand during local dev; CI applies migrations differently.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env') });

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
const pool = new Pool({ connectionString: url });

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
