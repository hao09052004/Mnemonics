// Quick DB probe — verify dev user favorites.
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
    "SELECT id, type, is_favorite, title FROM items " +
    "WHERE user_id = '8384248c-eef3-48ff-b3fd-ce09814c0197' AND is_favorite = true " +
    "ORDER BY created_at DESC"
  );
  console.log('Dev user favorites (' + r.rows.length + '):');
  for (const row of r.rows) console.log(' -', row.id, row.type, '|', row.title);
} finally {
  await pool.end();
}