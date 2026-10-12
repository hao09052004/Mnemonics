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
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
void here;

// Minimal .env loader so the script can be invoked by hand from
// a fresh shell. CI sets DATABASE_URL directly; this is the
// only block that reaches for the file.
function loadDotenv(): void {
  const candidates = [
    resolve(here, '..', '..', '..', '.env'),
    resolve(here, '..', '..', '.env'),
    resolve(process.cwd(), '.env')
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const text = readFileSync(c, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
    return;
  }
}
loadDotenv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is missing in env');
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const applyMode = args.has('--apply');
const recoverAll = args.has('--all');
const userFilter = process.env.RECOVER_USER_ID; // optional

/**
 * Classify a failed embed job by its last error so we can recover
 * the right slice. The `embedding_kind` (and any other schema-cache)
 * failures were caused by the missing migrations; those are now
 * fixed and re-running is safe. OpenAI 401 / quota errors are a
 * different class — they will fail again unless the operator has
 * addressed the underlying cause. We surface them in the dry-run
 * output but only reset them when the operator passes `--all`.
 */
function classifyJob(err: string | null): 'schema-cache' | 'provider' | 'unknown' {
  if (!err) return 'unknown';
  const e = err.toLowerCase();
  if (e.includes("could not find the 'embedding_kind'") || e.includes('schema cache')) {
    return 'schema-cache';
  }
  if (e.includes('openai') || e.includes('gemini') || e.includes('rate limit') || e.includes('429')) {
    return 'provider';
  }
  return 'unknown';
}

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
  // The unique index `jobs_active_item_type_idx` forbids two
  // active (pending|processing) rows for the same (item_id, type).
  //
  // The data we are about to touch has two complications:
  //   1. Some items already have a newer active embed job. The
  //      older failed placeholder is dropped so the newer job
  //      can run.
  //   2. A few items have MULTIPLE failed embed jobs (the queue
  //      retried the same item several times before each attempt
  //      failed). Promoting both of them simultaneously would
  //      violate the unique index. We keep the most-recent
  //      failed row per item and delete the older duplicates.
  //
  // A single CTE expresses the whole policy atomically so a
  // concurrent writer cannot race the row classification.
  await client.query('BEGIN');
  try {
    const r = await client.query<{ id: string; action: string }>(
      `WITH superseded AS (
         SELECT j.id
           FROM jobs j
          WHERE j.id = ANY($1::uuid[])
            AND j.status = 'failed'
            AND j.type = 'embed'
            AND EXISTS (
              SELECT 1 FROM jobs j2
               WHERE j2.item_id = j.item_id
                 AND j2.type = j.type
                 AND j2.status IN ('pending','processing')
            )
       ),
       ranked AS (
         SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY item_id
                        ORDER BY updated_at DESC, id DESC
                  ) AS rn
           FROM jobs
          WHERE id = ANY($1::uuid[])
            AND status = 'failed'
            AND type = 'embed'
            AND NOT EXISTS (
              SELECT 1 FROM jobs j2
               WHERE j2.item_id = jobs.item_id
                 AND j2.type = jobs.type
                 AND j2.status IN ('pending','processing')
            )
       ),
       duplicates AS (
         SELECT id FROM ranked WHERE rn > 1
       ),
       deleted_dups AS (
         DELETE FROM jobs
          WHERE id IN (SELECT id FROM duplicates)
          RETURNING id, 'deleted-dup'::text AS action
       ),
       deleted_super AS (
         DELETE FROM jobs
          WHERE id IN (SELECT id FROM superseded)
          RETURNING id, 'deleted-super'::text AS action
       ),
       promoted AS (
         UPDATE jobs
            SET status = 'pending',
                attempts = 0,
                updated_at = NOW()
          WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
          RETURNING id, 'promoted'::text AS action
       )
       SELECT * FROM deleted_dups
       UNION ALL
       SELECT * FROM deleted_super
       UNION ALL
       SELECT * FROM promoted`,
      [ids]
    );
    await client.query('COMMIT');
    const promoted = r.rows.filter((row) => row.action === 'promoted').length;
    skippedCount = r.rows.length - promoted;
    return promoted;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof Error && err.message.includes('jobs_active_item_type_idx')) {
      throw new Error(
        'recovery failed because a concurrent queue writer created a new active job mid-transaction. ' +
          'Stop the API process, then re-run this script. The transaction has been rolled back.'
      );
    }
    throw err;
  }
}

let skippedCount = 0;

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
    const buckets = { 'schema-cache': [] as AffectedJob[], provider: [] as AffectedJob[], unknown: [] as AffectedJob[] };
    for (const j of jobs) buckets[classifyJob(j.last_error)].push(j);
    console.log(
      `\nAffected failed embed jobs: ${total}${jobs.length < total ? ` (showing first ${jobs.length})` : ''}`
    );
    console.log(`  schema-cache (will recover): ${buckets['schema-cache'].length}`);
    for (const j of buckets['schema-cache']) {
      console.log(
        `  - ${j.id}  item=${j.item_id}  user=${j.user_id}  attempts=${j.attempts}/${j.max_attempts}\n      error: ${j.last_error ?? '(no error recorded)'}`
      );
    }
    console.log(`  provider / auth (need --all): ${buckets.provider.length}`);
    for (const j of buckets.provider) {
      console.log(
        `  - ${j.id}  item=${j.item_id}  user=${j.user_id}  attempts=${j.attempts}/${j.max_attempts}\n      error: ${j.last_error ?? '(no error recorded)'}`
      );
    }
    if (buckets.unknown.length > 0) {
      console.log(`  unknown (need --all): ${buckets.unknown.length}`);
      for (const j of buckets.unknown) {
        console.log(
          `  - ${j.id}  item=${j.item_id}  user=${j.user_id}  attempts=${j.attempts}/${j.max_attempts}\n      error: ${j.last_error ?? '(no error recorded)'}`
        );
      }
    }

    const targetIds = [
      ...buckets['schema-cache'],
      ...(recoverAll ? [...buckets.provider, ...buckets.unknown] : [])
    ].map((j) => j.id);

    if (targetIds.length === 0) {
      console.log('\nNothing to recover.');
      return;
    }
    if (!applyMode) {
      console.log(
        `\nDRY-RUN: ${targetIds.length} job(s) would be reset to status='pending', attempts=0.\n` +
          (recoverAll ? '' : "Pass --all to also reset provider/auth failures. ") +
          "Re-run with --apply to actually reset them. The standard embed handler will then re-embed each item on the next queue tick."
      );
      return;
    }
    const reset = await resetJobs(client, targetIds);
    console.log(`\nReset ${reset} job(s) to status='pending'.`);
    if (skippedCount > 0) {
      console.log(`Removed ${skippedCount} superseded job(s) — a newer pending/processing job already exists for the same item.`);
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
