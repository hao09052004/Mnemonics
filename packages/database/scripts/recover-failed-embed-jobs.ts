/**
 * Recover embedding jobs that failed with the
 * `Could not find the 'embedding_kind' column of 'item_embeddings'`
 * error.
 *
 * The previous code (commit before the schema-cache fix) wrote
 * `embedding_kind` and `embedding_version` to `item_embeddings`,
 * but migrations 022 and 023 were never applied to the target
 * database. Until they are, every embed job failed at the
 * `supabase.from("item_embeddings").upsert(...)` step. The job
 * queue retried three times and then left the job in `failed`.
 *
 * This script:
 *
 *   1. Verifies that `item_embeddings.embedding_kind` and
 *      `embedding_version` now exist (PostgreSQL `information_schema`).
 *      If the columns are still missing, the script REFUSES to
 *      recover — the operator must apply migrations 022 / 023
 *      first. (This is the order from Phase 1 of the migration
 *      plan.)
 *   2. Resets every `failed` job of type `embed` back to
 *      `pending` (in `--apply` mode) so the queue's normal
 *      processor picks them up on the next tick.
 *   3. Does NOT touch jobs that are already `completed`,
 *      `pending`, or `processing` — the script is strictly
 *      additive.
 *   4. In `--dry-run` mode (default) reports the count of jobs
 *      that WOULD be reset and exits without mutating anything.
 *
 * The actual re-embedding is performed by the standard
 * `EmbedHandler` in `apps/api/src/jobs/handlers/embed.ts`, which
 * already:
 *
 *   - upserts on `(item_id)` (no duplicate rows)
 *   - reads the configured embedding model at runtime
 *   - recomputes `item_document_chunks` for documents
 *   - rebuilds related memories (auto-link) and refreshes
 *     clusters on `markReadyIfComplete()`
 *
 * This script is therefore a thin recovery harness: it does
 * NOT re-embed anything itself.
 *
 * Usage:
 *   tsx packages/database/scripts/recover-failed-embed-jobs.ts            # dry-run
 *   tsx packages/database/scripts/recover-failed-embed-jobs.ts --apply   # actually reset
 *
 * Env:
 *   DATABASE_URL  (required)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
// We only use `pg`; the path is unused for now but kept so the
// script can be moved under the API package later without
// rewriting it.
void here;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is missing in env');
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const applyMode = args.has('--apply');
const userFilter = process.env.RECOVER_USER_ID; // optional

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

interface ColumnCheck {
  table: string;
  column: string;
  exists: boolean;
}

async function checkColumns(client: pg.PoolClient): Promise<ColumnCheck[]> {
  const r = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'item_embeddings' AND column_name IN ('embedding_kind', 'embedding_version', 'model'))
             OR (table_name = 'item_document_chunks' AND column_name IN ('embedding_kind', 'embedding_model')))
      ORDER BY table_name, column_name`
  );
  const found = new Set(r.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const expected: Array<{ table: string; column: string }> = [
    { table: 'item_embeddings', column: 'embedding_kind' },
    { table: 'item_embeddings', column: 'embedding_version' },
    { table: 'item_embeddings', column: 'model' },
    { table: 'item_document_chunks', column: 'embedding_kind' },
    { table: 'item_document_chunks', column: 'embedding_model' }
  ];
  return expected.map((c) => ({
    table: c.table,
    column: c.column,
    exists: found.has(`${c.table}.${c.column}`)
  }));
}

interface AffectedJob {
  id: string;
  item_id: string;
  user_id: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: Date;
}

async function listFailedEmbedJobs(
  client: pg.PoolClient
): Promise<{ jobs: AffectedJob[]; total: number }> {
  const params: unknown[] = [];
  let where = `status = 'failed' AND type = 'embed'`;
  if (userFilter) {
    params.push(userFilter);
    where += ` AND user_id = $${params.length}`;
  }
  // Sanity total first.
  const totalR = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM jobs WHERE ${where}`,
    params
  );
  const r = await client.query<AffectedJob>(
    `SELECT id, item_id, user_id, attempts, max_attempts,
            SUBSTRING(error, 1, 160) AS last_error,
            updated_at
       FROM jobs
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT 200`,
    params
  );
  return { jobs: r.rows, total: Number(totalR.rows[0]?.n ?? '0') };
}

async function resetJobs(client: pg.PoolClient, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await client.query<{ id: string }>(
    `UPDATE jobs
        SET status = 'pending',
            attempts = 0,
            updated_at = NOW()
      WHERE id = ANY($1::uuid[])
        AND status = 'failed'
        AND type = 'embed'
      RETURNING id`,
    [ids]
  );
  return r.rowCount ?? 0;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('Schema check:');
    const checks = await checkColumns(client);
    for (const c of checks) {
      const mark = c.exists ? 'OK ' : 'MISS';
      console.log(`  [${mark}] ${c.table}.${c.column}`);
    }
    const allPresent = checks.every((c) => c.exists);
    if (!allPresent) {
      console.error(
        '\nRefusing to recover: required columns are missing.\n' +
          'Apply migrations 022 and 023 first, then re-run this script.\n' +
          'See packages/database/scripts/migrate.ts for a safe runner.'
      );
      process.exit(3);
    }

    const { jobs, total } = await listFailedEmbedJobs(client);
    console.log(
      `\nAffected failed embed jobs: ${total}${jobs.length < total ? ` (showing first ${jobs.length})` : ''}`
    );
    for (const j of jobs) {
      const err = j.last_error ?? '(no error recorded)';
      console.log(
        `  - ${j.id}  item=${j.item_id}  user=${j.user_id}  attempts=${j.attempts}/${j.max_attempts}\n      error: ${err}`
      );
    }

    if (jobs.length === 0) {
      console.log('\nNothing to recover.');
      return;
    }
    if (!applyMode) {
      console.log(
        `\nDRY-RUN: ${jobs.length} job(s) would be reset to status='pending', attempts=0.\n` +
          'Re-run with --apply to actually reset them. The standard embed handler will then re-embed each item on the next queue tick.'
      );
      return;
    }
    const ids = jobs.map((j) => j.id);
    const reset = await resetJobs(client, ids);
    console.log(`\nReset ${reset} job(s) to status='pending'.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
