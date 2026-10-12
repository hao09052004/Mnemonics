// Apply migration 013: add `notes` column to items.
//
// Required environment:
//   DATABASE_URL   Postgres connection string, e.g.
//                  postgres://user:password@host:5432/db
//
// Hardcoded credentials were removed after a P0 secret-exposure
// incident; the previously committed connection string is treated
// as compromised and the password is expected to be rotated before
// reuse. The script fails fast when DATABASE_URL is missing rather
// than carrying a fallback that would defeat the rotation.

import pg from 'file:///C:/mnemonics-csp-fixed/node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not configured.');
  console.error('Set it before running, e.g.:');
  console.error('  DATABASE_URL=postgres://user:password@host:5432/db \\');
  console.error('    node apps/api/scripts/probe-items-schema.mts');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

try {
  // Idempotent: ADD COLUMN IF NOT EXISTS so re-running is safe.
  await pool.query('ALTER TABLE items ADD COLUMN IF NOT EXISTS notes TEXT');

  const cols = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'notes'
  `);
  console.log('notes column now:', cols.rows);
} finally {
  await pool.end();
}
