// Quick DB probe — verify dev user has favorites set in the DB.
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const pgRoot = join(resolve(here, '..'), 'node_modules', '.pnpm');
const dirs = await readdir(pgRoot);
let pgEntry = null;
for (const d of dirs) {
  if (!d.startsWith('pg@')) continue;
  const c = join(pgRoot, d, 'node_modules', 'pg', 'package.json');
  if (existsSync(c)) { pgEntry = c; break; }
}
const pg = createRequire(pgEntry)('pg');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  const r = await pool.query(
    "SELECT id, type, title, is_favorite, created_at FROM items " +
    "WHERE user_id = '8384248c-eef3-48ff-b3fd-ce09814c0197' " +
    "ORDER BY created_at DESC LIMIT 10"
  );
  console.log('items for dev user:');
  for (const row of r.rows) console.log(' -', row.id, row.type, 'fav=' + row.is_favorite, '|', row.title);

  const fav = await pool.query(
    "SELECT COUNT(*)::int as c FROM items " +
    "WHERE user_id = '8384248c-eef3-48ff-b3fd-ce09814c0197' AND is_favorite = true"
  );
  console.log('favorites count:', fav.rows[0].c);
} finally {
  await pool.end();
}