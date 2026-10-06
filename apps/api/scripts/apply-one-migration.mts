/**
 * Apply a single migration file by name, bypassing the ledger.
 *
 * Used when a file needs to run out of band (e.g. 018 after 017 was
 * blocked by a Postgres maintenance_work_mem limit that is a
 * deployment concern, not a schema one). The ledger is still updated
 * so a later `apply-migrations.mts` does not repeat it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { createPool } from '@mnemonics/database';

config({ path: join(process.cwd(), '.env'), quiet: true });
config({ path: join(process.cwd(), '../../.env'), quiet: true });

const file = process.argv[2];
if (!file) {
  console.error('usage: apply-one-migration.mts <file.sql>');
  process.exit(1);
}

const pool = createPool(process.env.DATABASE_URL || '');
const path = join(process.cwd(), '..', '..', 'packages', 'database', 'migrations', file);

try {
  await pool.query(readFileSync(path, 'utf8'));
  await pool.query(
    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
    [file]
  );
  console.log(`applied ${file}`);
} catch (error) {
  console.error(`failed ${file}: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
