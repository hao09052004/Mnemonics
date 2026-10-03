// Apply migration 013: add `notes` column to items.
import pg from 'file:///C:/mnemonics-csp-fixed/node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js';

const pool = new pg.Pool({
  connectionString: 'postgresql://postgres.jtmowwtmjtmceihzvreu:XB7MDkYj43Tgy8vp@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres',
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