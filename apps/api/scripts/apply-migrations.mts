/**
 * Apply pending SQL migrations in numeric order.
 *
 * Idempotent per file: each migration is written with IF EXISTS /
 * IF NOT EXISTS guards, and a file is skipped when the migrations
 * ledger already records it. Keeping the ledger in a local table
 * (rather than trusting file order) means a developer who applied 014
 * by hand is not re-run through it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { createPool } from '@mnemonics/database';

config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '../../.env') });

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'packages', 'database', 'migrations');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = createPool(url);

const ledger = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

async function main() {
  await pool.query(ledger);
  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename
    )
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  = ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pool.query(sql);
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [file]
      );
      console.log(`  + ${file}`);
      count += 1;
    } catch (error) {
      console.error(`  ! ${file} failed: ${(error as Error).message}`);
      process.exitCode = 1;
      break;
    }
  }
  console.log(count === 0 ? 'nothing to do' : `applied ${count} migration(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
