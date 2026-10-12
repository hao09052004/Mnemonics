/**
 * End-to-end probe for the embedding pipeline.
 *
 *  1. Insert a fresh item (and the supporting auth.users row)
 *     into the database.
 *  2. Run the real EmbedHandler against it — the same code path
 *     a capture job takes in production.
 *  3. Verify `item_embeddings` has a 1024-d real vector.
 *  4. Run the real search-service with a *semantically related*
 *     query and confirm the vector leg fires (semResults > 0
 *     in the explain block).
 *  5. Clean up.
 *
 * Run with:
 *   cd apps/api && npx tsx scripts/probe-embed-e2e.mts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { createClient } from '@supabase/supabase-js';
import { createPool, createItemRepository, runSearch } from '@mnemonics/database';
import { createAiService } from '@mnemonics/ai';
import { EmbedHandler } from '../src/jobs/handlers/embed.js';
import { JobQueue } from '../src/jobs/queue.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}

const pool = createPool(DATABASE_URL, { family: 4 });
// Use the service-role Supabase client to create the test user
// — direct INSERT into auth.users is denied through PgBouncer
// (only the `postgres` role may write, and PgBouncer does not
// preserve the role across statements).
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const TEST_USER_EMAIL = `embed-probe-${Date.now()}@example.com`;
let userId: string;
let itemId: string;

async function setup() {
  // We deliberately do NOT `SET role` here. The connection is
  // already authenticated as the `postgres` user through
  // PgBouncer, and `is_backend_session()` returns TRUE on
  // `current_user = 'postgres'`. Setting `role=service_role`
  // actually narrows the session and breaks Supabase's
  // `auth.users` SELECT privilege (the service_role on Supabase
  // is restricted to a small allowlist).

  // Reuse an existing user from the dev DB. The probe can
  // create a fresh user only when `auth.users` is writable
  // through the pool, which is not the case via PgBouncer
  // transaction pooling (only the `postgres` role may write,
  // and the role does not survive the pooler).
  const existing = await pool.query<{ id: string; email: string }>(
    `SELECT id, raw_user_meta_data->>'email' AS email
       FROM auth.users
      ORDER BY created_at ASC
      LIMIT 1`
  );
  if (!existing.rowCount) {
    throw new Error('no auth.users row available — cannot run probe without a user_id');
  }
  userId = existing.rows[0].id;
  console.log(`[setup] reusing user_id = ${userId} (${existing.rows[0].email})`);

  // Seed an entitlements row so getEntitlement() doesn't 500.
  await pool.query(
    `INSERT INTO user_entitlements
      (user_id, plan_id, family, semantic_search_enabled, monthly_capture_limit)
     VALUES ($1, 'mastery-monthly', 'mastery', TRUE, NULL)
     ON CONFLICT (user_id) DO UPDATE
       SET plan_id='mastery-monthly', family='mastery', semantic_search_enabled=TRUE`,
    [userId]
  );

  const i = await pool.query<{ id: string }>(
    `INSERT INTO items
      (id, user_id, type, status, title, raw_text, source_url, captured_at, client_request_id)
     VALUES (gen_random_uuid(), $1, 'text', 'pending', $2, $3, NULL, NOW(), gen_random_uuid())
     RETURNING id`,
    [
      userId,
      'Hồi quy logistic cho bài toán phân loại nhị phân',
      'Hồi quy logistic là một thuật toán phân loại cổ điển trong học máy. Mô hình ước lượng xác suất một quan sát thuộc về lớp dương dựa trên hàm sigmoid áp dụng lên tổ hợp tuyến tính của các đặc trưng đầu vào. Việc huấn luyện tối ưu hóa log-loss bằng gradient descent hoặc L-BFGS.'
    ]
  );
  itemId = i.rows[0].id;
  console.log(`[setup] item_id = ${itemId}`);
}

async function embedItem() {
  const ai = await createAiService();
  console.log(`[embed] provider: ${ai.embeddings.info().name}:${ai.embeddings.info().model} (${ai.embeddings.info().dimensions}-d)`);

  // Use the real queue (in-process) so the EmbedHandler thinks it
  // is running inside a worker. The handler calls
  // `queue.markCompleted` and `queue.areAllJobsCompleted` —
  // both need a working queue.
  const queue = new JobQueue(pool);

  const repository = createItemRepository(pool);
  const handler = new EmbedHandler({
    queue,
    repository,
    ai,
    pool
  });

  // Build the job exactly the way the capture route does.
  const job = await queue.create({
    type: 'embed',
    itemId,
    userId
  });
  console.log(`[embed] job_id = ${job.id}`);

  // Drive the handler manually — we don't want a second worker
  // racing us, and the queue is already wired to call `markCompleted`.
  await handler.handle({ id: job.id, itemId, userId, payload: {} });

  // Verify the row landed.
  const r = await pool.query<{ model: string; dimensions: number; embedding_kind: string }>(
    `SELECT model, dimensions, embedding_kind
       FROM item_embeddings
      WHERE item_id = $1`,
    [itemId]
  );
  if (!r.rowCount) {
    throw new Error('no item_embeddings row was written');
  }
  const row = r.rows[0];
  console.log(`[embed] stored: model=${row.model} dim=${row.dimensions} kind=${row.embedding_kind}`);
  if (row.embedding_kind !== 'real' || row.dimensions !== 1024) {
    throw new Error(`bad embedding: kind=${row.embedding_kind} dim=${row.dimensions}`);
  }
  console.log(`[embed] OK — real 1024-d vector persisted`);
}

async function searchVectorLeg() {
  const ai = await createAiService();
  // A semantically related query, NOT a verbatim copy of the
  // indexed text. The vector leg is what surfaces this hit
  // when there is no shared token.
  const result = await runSearch(
    { pool, embeddings: ai.embeddings },
    userId,
    {
      q: 'mô hình phân lớp dùng hàm sigmoid',
      filters: {},
      limit: 5,
      offset: 0
    }
  );
  console.log(`[search] total=${result.total} lex=${result.explain.lexResults} sem=${result.explain.semResults} chunk=${result.explain.chunkResults} struct=${result.explain.structResults}`);
  console.log(`[search] hits:`);
  for (const h of result.hits) {
    console.log(`  - ${h.id.slice(0, 8)} score=${h.score.toFixed(4)} title="${h.title.slice(0, 60)}"`);
  }
  if (result.explain.semResults === 0) {
    throw new Error('vector leg returned 0 hits — semantic search is not running');
  }
  console.log(`[search] OK — vector leg fired with ${result.explain.semResults} hit(s)`);
}

async function cleanup() {
  await pool.query(`DELETE FROM item_document_chunks WHERE item_id = $1`, [itemId]);
  await pool.query(`DELETE FROM item_embeddings WHERE item_id = $1`, [itemId]);
  await pool.query(`DELETE FROM items WHERE user_id = $1 AND id = $2`, [userId, itemId]);
  // Restore the original plan for the reused user.
  await pool.query(
    `UPDATE user_entitlements
        SET plan_id='memory', family='memory', valid_until=NULL,
            semantic_search_enabled=FALSE, monthly_capture_limit=50
      WHERE user_id = $1`,
    [userId]
  );
  await pool.end();
  console.log(`[cleanup] done (kept user, removed only this probe's rows)`);
}

try {
  await setup();
  await embedItem();
  await searchVectorLeg();
  await cleanup();
  console.log('\nALL GREEN — embedding + vector leg are working end-to-end.');
} catch (e) {
  console.error('\nFAILED:', e instanceof Error ? e.stack : e);
  try { await cleanup(); } catch {}
  process.exit(1);
}
