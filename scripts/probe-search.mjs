// Probe semantic search state for the active user.
// Goal: figure out WHERE the search pipeline is dropping results
// — DB (fts/embeddings) → RPC → API → client. Run this and
// read the output to know which layer is the bottleneck.
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
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const userId = process.argv[2] || '8384248c-eef3-48ff-b3fd-ce09814c0197';
const query = process.argv[3] || 'học tiếng Anh';
const kind = (process.argv[4] || '').toLowerCase(); // optional: 'sem' | 'lex' | ''

async function run() {
  // 1. Total items + favorites
  const t = await pool.query('SELECT COUNT(*)::int AS n FROM items WHERE user_id = $1', [userId]);
  console.log(`ITEMS_TOTAL=${t.rows[0].n}`);

  // 2. Embeddings present
  const e = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM item_embeddings ie
       JOIN items i ON i.id = ie.item_id
      WHERE i.user_id = $1`,
    [userId]
  );
  console.log(`EMBEDDINGS=${e.rows[0].n}`);

  // 3. Sample searchable_text
  const s = await pool.query(
    `SELECT title, length(coalesce(raw_text, '')) AS raw_len,
            length(coalesce(ocr_text, '')) AS ocr_len,
            searchable_text IS NOT NULL AS has_fts
       FROM items WHERE user_id = $1 ORDER BY captured_at DESC LIMIT 3`,
    [userId]
  );
  for (const r of s.rows) {
    console.log(`SAMPLE title="${(r.title || '').slice(0, 50)}" raw_len=${r.raw_len} ocr_len=${r.ocr_len} has_fts=${r.has_fts}`);
  }

  // 4. Direct tsquery match count
  const ft = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM items
      WHERE user_id = $1
        AND searchable_text @@ plainto_tsquery('simple', $2)`,
    [userId, query]
  );
  console.log(`TSQUERY_MATCH=${ft.rows[0].n}`);

  // 5. Vector match (cosine < 0.5) — sanity: at least one embedding is not zero
  const v = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM item_embeddings ie
       JOIN items i ON i.id = ie.item_id
      WHERE i.user_id = $1 AND ie.embedding IS NOT NULL`,
    [userId]
  );
  console.log(`VEC_NON_NULL=${v.rows[0].n}`);

  // 6. Run the search_items RPC and print rows
  // 6. Job queue: how many embed jobs are still pending / failed for
  // this user. A lot of pending=ready and failed embed jobs is the
  // diagnostic that says "the worker is using a noop provider" or
  // "the provider is throwing". Run before the RPC so a fatal RPC
  // error doesn't hide the queue state.
  try {
    const j = await pool.query(
      `SELECT type, status, COUNT(*)::int AS n
         FROM jobs
        WHERE user_id = $1
        GROUP BY type, status
        ORDER BY type, status`,
      [userId]
    );
    console.log('JOB_COUNTS:');
    for (const r of j.rows) console.log(`  type=${r.type} status=${r.status} n=${r.n}`);
  } catch (e) {
    console.log('JOB_COUNTS_ERR=' + e.message);
  }
  try {
    const r = await pool.query(
      `SELECT * FROM search_items($1, $2, NULL, NULL, 5, 0)`,
      [userId, query]
    );
    console.log(`RPC_search_items ROWS=${r.rowCount}`);
    for (const row of r.rows) {
      console.log(`  - title="${(row.title || '').slice(0, 50)}" lex=${row.lex_score} sem=${row.sem_score} combined=${row.combined_score} rank=${row.rank}`);
    }
  } catch (err) {
    console.log('RPC_ERR=' + err.message);
  }
  // 7. Sample failed embed jobs to see WHY they failed. The error
  // column in the jobs table is the single best signal for which
  // provider error is the root cause. Group by the first 100 chars
  // of the error to make duplicates visible.
  try {
    const fj = await pool.query(
      `SELECT id, item_id, attempts, error, created_at, updated_at
         FROM jobs
        WHERE user_id = $1 AND type = 'embed' AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 5`,
      [userId]
    );
    console.log(`FAILED_EMBED_SAMPLE rows=${fj.rowCount}`);
    for (const r of fj.rows) {
      const err = (r.error || '').toString().slice(0, 220);
      console.log(`  job=${String(r.id).slice(0, 8)} item=${String(r.item_id).slice(0, 8)} attempts=${r.attempts} created=${r.created_at?.toISOString?.() || r.created_at} updated=${r.updated_at?.toISOString?.() || r.updated_at} err="${err}"`);
    }
  } catch (e) {
    console.log('FAILED_EMBED_ERR=' + e.message);
  }
  // 8. Re-enqueue embed for every item that has no row in
  // item_embeddings. The previous worker used a removed OpenAI
  // provider and failed 17/22 jobs with `OpenAI API error: 401`,
  // so 23 items are still missing vectors. The current worker
  // uses Gemini -> Ollama, which has its own key, so the jobs
  // will succeed now. We use a fresh payload so the new embed
  // job is distinguishable in the audit log from the old ones.
  try {
    const byStatus = await pool.query(
      `SELECT COALESCE(status, '<null>') AS status, COUNT(*)::int AS n
         FROM items
        WHERE user_id = $1
        GROUP BY status
        ORDER BY status`,
      [userId]
    );
    console.log('ITEM_STATUS_COUNTS:');
    for (const r of byStatus.rows) console.log(`  status=${r.status} n=${r.n}`);
    if (byStatus.rowCount === 0) {
      console.log('  (no items at all)');
    }

    // Items that need an embedding backfill. We target any item that
    // does not have a row in `item_embeddings`, regardless of its
    // current `status` value (some legacy rows have status=NULL).
    const need = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM items i
         LEFT JOIN item_embeddings ie ON ie.item_id = i.id
        WHERE i.user_id = $1
          AND ie.item_id IS NULL`,
      [userId]
    );
    console.log(`NEED_EMBED_BACKFILL=${need.rows[0].n}`);

    const re = await pool.query(
      `INSERT INTO jobs (type, item_id, user_id, status, payload)
       SELECT 'embed', i.id, i.user_id, 'pending',
              jsonb_build_object('reason', 'backfill-after-openai-removal',
                                 'probe', 'probe-search.mjs')
         FROM items i
         LEFT JOIN item_embeddings ie ON ie.item_id = i.id
        WHERE i.user_id = $1
          AND ie.item_id IS NULL
       RETURNING id, item_id`,
      [userId]
    );
    console.log(`REQUEUED_EMBED rows=${re.rowCount}`);
    for (const r of re.rows) console.log(`  job=${String(r.id).slice(0, 8)} item=${String(r.item_id).slice(0, 8)}`);
  } catch (e) {
    console.log('REQUEUE_ERR=' + e.message);
  }
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
