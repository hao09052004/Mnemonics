// Test which subexpression of search_items() breaks.
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
const envFile = resolve(here, '..', '.env');
const { readFileSync } = await import('node:fs');
readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const u = '8384248c-eef3-48ff-b3fd-ce09814c0197';

async function run(label, sql, params) {
  try {
    const r = await pool.query(sql, params);
    console.log(label + ' OK rows=' + r.rowCount);
  } catch (e) {
    console.log(label + ' ERR=' + e.message);
  }
}

// Variant A: same as migration 020, subquery wrap
await run('A_subquery',
  `WITH combined AS (SELECT id FROM items WHERE user_id = $1 LIMIT 1),
        projected AS (
          SELECT i.id FROM items i JOIN combined c ON c.id = i.id
        )
   SELECT * FROM projected`,
  [u]);

// Variant B: no subquery, direct join
await run('B_direct',
  `WITH combined AS (SELECT id FROM items WHERE user_id = $1 LIMIT 1)
   SELECT i.id FROM items i JOIN combined c ON c.id = i.id`,
  [u]);

// Variant C: function with subquery, same shape as 020
await run('C_function',
  `SELECT * FROM search_items($1, 'Facebook', NULL, NULL, 5, 0)`,
  [u]);

await pool.end();
