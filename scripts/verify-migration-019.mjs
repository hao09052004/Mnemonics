import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pgRoot = join(repoRoot, 'node_modules', '.pnpm');
const dirs = await readdir(pgRoot);
let pgEntry = null;
for (const d of dirs) {
  if (!d.startsWith('pg@')) continue;
  const candidate = join(pgRoot, d, 'node_modules', 'pg', 'package.json');
  if (existsSync(candidate)) { pgEntry = candidate; break; }
}
if (!pgEntry) throw new Error('pg not found in .pnpm');
const pg = createRequire(pgEntry)('pg');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  const probe = await pool.query(
    "SELECT column_name, data_type, is_nullable " +
    "FROM information_schema.columns " +
    "WHERE table_schema='public' AND table_name='items' " +
    "AND column_name IN ('page_count','type','is_favorite') " +
    "ORDER BY column_name"
  );
  console.log('items columns:', probe.rows);

  const sample = await pool.query(
    "SELECT id, type, page_count FROM items ORDER BY created_at DESC LIMIT 3"
  );
  console.log('sample rows:', sample.rows);

  const ck = await pool.query(
    "SELECT conname, pg_get_constraintdef(oid) " +
    "FROM pg_constraint WHERE conrelid='items'::regclass " +
    "AND conname='items_type_check'"
  );
  console.log('type_check:', ck.rows);

  const ck2 = await pool.query(
    "SELECT conname, pg_get_constraintdef(oid) " +
    "FROM pg_constraint WHERE conrelid='assets'::regclass " +
    "AND conname='assets_mime_type_check'"
  );
  console.log('assets_mime_check:', ck2.rows);

  const ck3 = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns " +
    "WHERE table_schema='public' AND table_name='item_enrichments' " +
    "AND column_name IN ('extraction_status','extraction_error_code')"
  );
  console.log('item_enrichments additions:', ck3.rows);
} finally {
  await pool.end();
}