#!/usr/bin/env node
/**
 * scripts/apply-migration-019.mjs
 *
 * One-shot helper: applies ONLY migration 019 (document capture) to the
 * dev/staging database the caller points at via DATABASE_URL.
 *
 * Why this exists:
 *   - `apply-migrations.mjs` only handles the bootstrap trio (004/005/006)
 *     used by the demo reset path. It does not touch 019.
 *   - The API's `GET /api/v1/items` now SELECTs `items.page_count` (and a
 *     handful of `assets.*`/`item_enrichments.*` columns). Without 019 the
 *     column does not exist and the route 500s with:
 *         error: column "page_count" does not exist
 *
 * The script is idempotent because 019 itself is written with
 * `IF NOT EXISTS` and `DROP CONSTRAINT IF EXISTS`. Safe to re-run.
 *
 * Usage:
 *   node scripts/apply-migration-019.mjs
 *   DATABASE_URL=... node scripts/apply-migration-019.mjs   # explicit override
 *
 * Exit codes:
 *   0  applied successfully (or already applied — no-op)
 *   1  migration file missing
 *   2  DATABASE_URL missing
 *   3  SQL execution failed (error printed)
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..'); // scripts/ is at <repoRoot>/scripts/
const migrationsDir = join(repoRoot, 'packages', 'database', 'migrations');
const target = join(migrationsDir, '019_documents.sql');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is missing in env');
  process.exit(2);
}

// `pg` lives under `.pnpm/...` in this workspace (no root package.json
// dependency), so a bare `import 'pg'` from the repo root would fail.
// Resolve the pg entrypoint by walking into the .pnpm store directly.
const pgRoot = join(repoRoot, 'node_modules', '.pnpm');
async function findPgPackageJson() {
  if (!existsSync(pgRoot)) return null;
  const dirs = await readdir(pgRoot);
  for (const d of dirs) {
    if (!d.startsWith('pg@')) continue;
    const candidate = join(pgRoot, d, 'node_modules', 'pg', 'package.json');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const pgEntry = await findPgPackageJson();
if (!pgEntry) {
  console.error('[migrate] could not locate pg inside .pnpm store at', pgRoot);
  process.exit(2);
}
const pgRequire = createRequire(pgEntry);
const pg = pgRequire('pg');

const pool = new pg.Pool({
  connectionString: databaseUrl,
  // Supabase pooler requires TLS; mirror the behaviour of apply-migrations.mjs.
  ssl: { rejectUnauthorized: false }
});

try {
  const sql = await readFile(target, 'utf8');
  console.log(`[migrate] applying ${target}`);
  await pool.query(sql);
  console.log('[migrate] ok');

  // Tiny post-check so the operator can confirm the column landed.
  const probe = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='items' AND column_name='page_count'`
  );
  if (probe.rows.length === 0) {
    console.warn('[migrate] WARNING: items.page_count still not visible after apply');
    process.exit(3);
  }
  console.log('[migrate] confirmed: items.page_count exists');
} catch (e) {
  console.error('[migrate] ERR:', e.message);
  process.exit(3);
} finally {
  await pool.end();
}