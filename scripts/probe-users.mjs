// List recent items + favorites for the active web user.
// The user_id for the web dashboard session is derived from the
// active session — we can't read that from a separate process, so
// just dump the most recent 30 items across the table.
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
    "SELECT user_id, COUNT(*)::int as total, " +
    "SUM(CASE WHEN is_favorite THEN 1 ELSE 0 END)::int as favorites " +
    "FROM items GROUP BY user_id ORDER BY total DESC LIMIT 10"
  );
  console.log('users with items:');
  for (const row of r.rows) console.log(' -', row.user_id, 'total=' + row.total, 'favorites=' + row.favorites);
} finally {
  await pool.end();
}