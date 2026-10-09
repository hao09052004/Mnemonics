/**
 * Safe migration runner.
 *
 * Replaces the previous `apply-pending.mts`, which hard-coded
 * `021_content_clusters.sql` and re-ran it on every invocation
 * (most of `021` happens to be idempotent, but that was a
 * coincidence — the script made no attempt to track what was
 * applied and would happily re-run any non-idempotent migration
 * blindly).
 *
 * Design:
 *
 *   1. Discover every `NNN_*.sql` file under
 *      `packages/database/migrations/`, in numerical order.
 *   2. Read the `schema_migrations` ledger (`id`, `sha256`,
 *      `applied_at`). Auto-create the ledger if missing; the
 *      CREATE is the only DDL this script runs without an
 *      explicit `--apply` flag.
 *   3. For each migration:
 *        a. If the file is recorded as already applied:
 *           - Verify the SHA-256 still matches. If it has
 *             been edited after the fact, STOP and report;
 *             re-running mutated SQL is unsafe.
 *        b. If the file is not recorded:
 *           - In `--apply` mode, run the SQL inside a
 *             transaction (with `BEGIN`/`COMMIT` no-ops stripped
 *             so the wrapper transaction composes cleanly),
 *             then INSERT into the ledger.
 *           - In dry-run mode (default), report it and continue.
 *   4. After the loop, probe the schema for the columns the
 *      application expects (`item_embeddings.embedding_kind`,
 *      `item_embeddings.embedding_version`,
 *      `item_document_chunks` table). A missing probe column
 *      exits non-zero so CI catches drift.
 *
 * The runner NEVER runs a migration whose ID is already in the
 * ledger and whose SHA-256 still matches. It NEVER runs any
 * non-idempotent SQL blindly. It NEVER modifies production
 * data without an explicit `--apply` flag.
 *
 * Usage:
 *   tsx packages/database/scripts/migrate.ts                # dry-run
 *   tsx packages/database/scripts/migrate.ts --apply        # run pending
 *   tsx packages/database/scripts/migrate.ts --schema-probe # only probe
 *
 * Env:
 *   DATABASE_URL  (required) — postgres:// connection string.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is missing in env');
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const applyMode = args.has('--apply');
const probeOnly = args.has('--schema-probe');

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Strip `BEGIN;` / `COMMIT;` from a migration so the runner can
 * wrap it in its own transaction. PostgreSQL has no nested
 * transactions; the alternative (per-statement savepoints) is
 * noisier and not what migration 001-024 expects.
 *
 * The match is intentionally loose (any line starting with the
 * keyword, ignoring leading whitespace) — that is exactly the
 * shape every existing migration uses.
 */
function stripTransactionWrappers(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t !== 'BEGIN;' && t !== 'COMMIT;';
    })
    .join('\n');
}

async function ensureLedger(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT        PRIMARY KEY,
      sha256      TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listMigrationFiles(): Promise<string[]> {
  const all = await readdir(migrationsDir);
  return all
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
}

async function readLedger(
  client: pg.PoolClient
): Promise<Map<string, { sha256: string; appliedAt: Date }>> {
  const r = await client.query<{ id: string; sha256: string; applied_at: Date }>(
    `SELECT id, sha256, applied_at FROM schema_migrations`
  );
  const m = new Map<string, { sha256: string; appliedAt: Date }>();
  for (const row of r.rows) m.set(row.id, { sha256: row.sha256, appliedAt: row.applied_at });
  return m;
}

interface MigrationDecision {
  id: string;
  status: 'already-applied' | 'would-apply' | 'apply-ok' | 'mismatch' | 'error';
  detail: string;
}

async function runMigrations(
  client: pg.PoolClient,
  files: string[]
): Promise<MigrationDecision[]> {
  const decisions: MigrationDecision[] = [];
  const ledger = await readLedger(client);

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const hash = sha256(sql);
    const recorded = ledger.get(file);
    if (recorded) {
      if (recorded.sha256 !== hash) {
        decisions.push({
          id: file,
          status: 'mismatch',
          detail: `ledger sha256=${recorded.sha256.slice(0, 12)}… file sha256=${hash.slice(0, 12)}… (file was edited after being applied — refusing to re-run)`
        });
        return decisions; // stop the moment we see a mismatch
      }
      decisions.push({
        id: file,
        status: 'already-applied',
        detail: `applied at ${recorded.appliedAt.toISOString()} sha256=${hash.slice(0, 12)}…`
      });
      continue;
    }
    if (!applyMode) {
      decisions.push({
        id: file,
        status: 'would-apply',
        detail: `sha256=${hash.slice(0, 12)}… (dry-run; pass --apply to run)`
      });
      continue;
    }
    try {
      const body = stripTransactionWrappers(sql);
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query(
          `INSERT INTO schema_migrations (id, sha256) VALUES ($1, $2)`,
          [file, hash]
        );
        await client.query('COMMIT');
      } catch (innerErr) {
        await client.query('ROLLBACK');
        throw innerErr;
      }
      decisions.push({
        id: file,
        status: 'apply-ok',
        detail: `sha256=${hash.slice(0, 12)}…`
      });
    } catch (err) {
      decisions.push({
        id: file,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err)
      });
      return decisions;
    }
  }
  return decisions;
}

interface SchemaProbe {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

async function probeSchema(client: pg.PoolClient): Promise<SchemaProbe> {
  const checks: SchemaProbe['checks'] = [];
  const columnChecks = [
    { table: 'item_embeddings', column: 'embedding_kind' },
    { table: 'item_embeddings', column: 'embedding_version' },
    { table: 'item_embeddings', column: 'model' },
    { table: 'item_document_chunks', column: 'embedding' }
  ];
  for (const c of columnChecks) {
    const r = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS exists`,
      [c.table, c.column]
    );
    const ok = r.rows[0]?.exists === true;
    checks.push({
      name: `column ${c.table}.${c.column}`,
      ok,
      detail: ok ? 'present' : 'MISSING — apply the migrations that add this column'
    });
  }
  // Embedding identity view is the read surface the search service uses.
  const viewR = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.views
       WHERE table_schema = 'public' AND table_name = 'item_embeddings_real'
     ) AS exists`,
    []
  );
  const viewOk = viewR.rows[0]?.exists === true;
  checks.push({
    name: 'view item_embeddings_real',
    ok: viewOk,
    detail: viewOk ? 'present' : 'MISSING — run migration 022 to create it'
  });

  return {
    ok: checks.every((c) => c.ok),
    checks
  };
}

function printDecisions(decisions: MigrationDecision[]): void {
  for (const d of decisions) {
    const tag = d.status.toUpperCase().padEnd(16);
    console.log(`  [${tag}] ${d.id}  —  ${d.detail}`);
  }
}

function printProbe(probe: SchemaProbe): void {
  console.log('Schema probe:');
  for (const c of probe.checks) {
    const mark = c.ok ? 'OK ' : 'MISS';
    console.log(`  [${mark}] ${c.name} — ${c.detail}`);
  }
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureLedger(client);
    if (probeOnly) {
      const probe = await probeSchema(client);
      printProbe(probe);
      process.exit(probe.ok ? 0 : 3);
    }
    const files = await listMigrationFiles();
    console.log(
      `Migrations in queue: ${files.length} (${applyMode ? 'APPLY' : 'DRY-RUN'})`
    );
    const decisions = await runMigrations(client, files);
    printDecisions(decisions);

    const hadMismatch = decisions.some((d) => d.status === 'mismatch');
    const hadError = decisions.some((d) => d.status === 'error');
    if (hadMismatch || hadError) {
      console.error('\nMIGRATION RUN FAILED — see above.');
      process.exit(4);
    }

    const probe = await probeSchema(client);
    console.log('');
    printProbe(probe);
    if (!probe.ok) {
      console.error('\nSchema probe FAILED — expected columns/views missing.');
      process.exit(5);
    }
    if (!applyMode) {
      console.log(
        '\nDRY-RUN: no migrations were applied. Re-run with --apply to commit.'
      );
    } else {
      console.log('\nMigrations applied and recorded in schema_migrations.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
