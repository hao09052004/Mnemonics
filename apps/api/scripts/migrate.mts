/**
 * Apply any missing SQL migrations to the configured database.
 *
 * Reads every `packages/database/migrations/*.sql` file in lexical order and
 * executes the ones that have not been recorded yet. A file is recorded by
 * inserting its filename into the `schema_migrations` table, which this
 * script creates on first run.
 *
 * Each migration is applied inside its own transaction so a failure leaves the
 * table list in a known state instead of half-applied. `CREATE INDEX
 * CONCURRENTLY` is the one statement that cannot run inside a transaction; none
 * of the current migrations use it.
 *
 * Usage:
 *   pnpm --filter @mnemonics/api exec tsx scripts/migrate.mts
 *   pnpm --filter @mnemonics/api exec tsx scripts/migrate.mts --status
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from 'dotenv';
import { createPool } from '@mnemonics/database';

config({ path: resolve(process.cwd(), '../../.env') });

const MIGRATIONS_DIR = resolve(process.cwd(), '../../packages/database/migrations');
const statusOnly = process.argv.includes('--status');

const pool = createPool(process.env.DATABASE_URL!);

async function ensureRegistry() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

await ensureRegistry();
const appliedRows = await pool.query('SELECT filename FROM schema_migrations');
const applied = new Set(appliedRows.rows.map((r: { filename: string }) => r.filename));

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (statusOnly) {
  console.log(`applied: ${applied.size} / ${files.length}`);
  for (const f of files) {
    console.log(`  ${applied.has(f) ? '[x]' : '[ ]'} ${f}`);
  }
  await pool.end();
  process.exit(0);
}

// Safety: when the registry is empty the existing schema was created by hand
// (Supabase SQL editor), so replaying 001..013 would either fail or, worse,
// re-run destructive DDL. Probe for a table/column fingerprint per migration,
// backfill the registry for the ones already present, and only then run what
// is genuinely missing.
if (applied.size === 0) {
  console.log('registry is empty — probing which migrations are already present...\n');
  const fingerprints: Record<string, { sql: string; args: string[] }> = {
    '001_create_items.sql': { sql: "SELECT to_regclass('public.items') AS o", args: [] },
    '002_create_profiles.sql': { sql: "SELECT to_regclass('public.profiles') AS o", args: [] },
    '003_auth_hardening.sql': { sql: "SELECT to_regclass('public.auth_events') AS o", args: [] },
    '004_job_queue.sql': { sql: "SELECT to_regclass('public.jobs') AS o", args: [] },
    '005_pgvector_search.sql': { sql: "SELECT to_regclass('public.item_embeddings') AS o", args: [] },
    '006_knowledge_graph.sql': { sql: "SELECT to_regclass('public.item_edges') AS o", args: [] },
    '007_backend_rls_bypass.sql': { sql: "SELECT to_regclass('public.assets') AS o", args: [] },
    '008_relax_item_type_check.sql': { sql: "SELECT to_regclass('public.items') AS o", args: [] },
    '009_fix_searchable_text_type.sql': { sql: "SELECT to_regclass('public.items') AS o", args: [] },
    '010_active_job_uniqueness.sql': { sql: "SELECT to_regclass('public.jobs') AS o", args: [] },
    '011_add_item_favorite.sql': {
      sql: "SELECT 1 AS o FROM information_schema.columns WHERE table_schema='public' AND table_name='items' AND column_name='is_favorite'",
      args: []
    },
    '012_ocr_metadata_and_quota.sql': { sql: "SELECT to_regclass('public.ocr_quota') AS o", args: [] },
    '013_add_item_notes.sql': {
      sql: "SELECT 1 AS o FROM information_schema.columns WHERE table_schema='public' AND table_name='items' AND column_name='notes'",
      args: []
    },
    '014_spaces.sql': { sql: "SELECT to_regclass('public.spaces') AS o", args: [] },
    '015_item_enrichments.sql': { sql: "SELECT to_regclass('public.item_enrichments') AS o", args: [] },
    '016_allow_enrich_job.sql': {
      sql: `SELECT 1 AS o FROM pg_constraint
            WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_type_check'
              AND pg_get_constraintdef(oid) LIKE '%enrich%'`,
      args: []
    }
  };
  for (const [file, probe] of Object.entries(fingerprints)) {
    const { rows } = await pool.query(probe.sql, probe.args);
    const present = probe.sql.includes('information_schema') ? rows.length > 0 : Boolean(rows[0].o);
    if (present) {
      applied.add(file);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
      console.log(`  already present: ${file}`);
    }
  }
  const remaining = files.filter((f) => !applied.has(f));
  console.log(`\ngenuinely missing: ${remaining.length ? remaining.join(', ') : 'none'}\n`);
  if (remaining.length === 0) {
    await pool.end();
    process.exit(0);
  }
}

const todo = files.filter((f) => !applied.has(f));
if (todo.length === 0) {
  console.log(`schema is up to date (${files.length} migrations applied)`);
  await pool.end();
  process.exit(0);
}

console.log(`applying ${todo.length} migration(s):`);
for (const file of todo) {
  process.stdout.write(`  ${file} ... `);
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log('ok');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.log('FAILED');
    console.error(`\n${(error as Error).message}\n`);
    // Show the failing statement's neighbourhood so the cause is obvious.
    const lines = sql.split('\n');
    console.error('migration source (first 40 lines):');
    console.error(lines.slice(0, 40).map((l, i) => `${String(i + 1).padStart(3)} | ${l}`).join('\n'));
    process.exitCode = 1;
    break;
  } finally {
    client.release();
  }
}

if (process.exitCode) {
  console.error('\nmigration run aborted; re-run after fixing the failing file');
} else {
  const total = (await pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n;
  console.log(`\nschema_migrations now has ${total} entries`);
}

await pool.end();
