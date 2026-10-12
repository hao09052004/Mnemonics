/**
 * M4 — dataset seeder.
 *
 * Inserts the dataset's memories and classifications into
 * a fresh bench user, returning a `Map<datasetId, itemId>`
 * so the runner can re-key queries' `relevant_ids` to the
 * real `items.id`s.
 *
 * `cleanupBenchmarkDataset()` removes everything that was
 * inserted (cascades through `item_classifications`).
 */
import type { Pool } from 'pg';
import type { Dataset } from './dataset.js';

export interface SeederResult {
  userId: string;
  /** dataset.id → items.id */
  idMap: Map<string, string>;
}

export async function seedBenchmarkDataset(
  pool: Pool,
  dataset: Dataset
): Promise<SeederResult> {
  const userId = await createBenchUser(pool);
  const idMap = new Map<string, string>();

  for (const memory of dataset.memories) {
    const itemId = await insertItem(pool, userId, memory);
    await insertClassification(pool, userId, itemId, memory);
    idMap.set(memory.id, itemId);
  }

  return { userId, idMap };
}

export async function cleanupBenchmarkDataset(
  pool: Pool,
  result: SeederResult
): Promise<void> {
  // `items` cascades to `item_classifications` and
  // `embeddings`. Removing the user removes the rows.
  await pool.query(`DELETE FROM auth.users WHERE id = $1`, [result.userId]);
}

async function createBenchUser(pool: Pool): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [`bench-${Date.now()}-${Math.random()}@example.com`]
  );
  return String(r.rows[0].id);
}

async function insertItem(
  pool: Pool,
  userId: string,
  memory: Dataset['memories'][number]
): Promise<string> {
  if (memory.type !== 'link' && memory.type !== 'text' && memory.type !== 'image'
      && memory.type !== 'screenshot' && memory.type !== 'document') {
    throw new Error(`unsupported memory.type: ${memory.type}`);
  }
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO items
         (user_id, type, title, raw_text, source_url, captured_at, status, client_request_id)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 'ready', gen_random_uuid())
       RETURNING id`,
      [
        userId,
        memory.type,
        memory.title,
        memory.raw_text,
        memory.source_url,
        memory.captured_at
      ]
    );
    return String(r.rows[0].id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('insertItem failed for memory', memory.id, 'type=', memory.type, msg);
    throw e;
  }
}

async function insertClassification(
  pool: Pool,
  userId: string,
  itemId: string,
  memory: Dataset['memories'][number]
): Promise<void> {
  const valid = new Set(['article','product','recipe','video','quote','highlight',
    'webpage','image','note','document','other']);
  if (!valid.has(memory.classification.detected_type)) {
    throw new Error(`unsupported detected_type: ${memory.classification.detected_type}`);
  }
  try {
    await pool.query(
      `INSERT INTO item_classifications
         (item_id, user_id, detected_type, category, description,
          attributes, entities, evidence, confidence, provider, model,
          classifier_version, status, error_code, content_hash)
       VALUES ($1, $2, $3, $4, $5,
               $6::jsonb, '[]'::jsonb, '{}'::jsonb, 0.95, 'gemini',
               'gemini-3.5-flash-lite', 'v1', 'ready', NULL, $7)`,
      [
        itemId,
        userId,
        memory.classification.detected_type,
        memory.classification.category,
        null,
        JSON.stringify(memory.classification.attributes),
        `sha:bench:${memory.id}`
      ]
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('insertClassification failed for memory', memory.id, 'detected_type=', memory.classification.detected_type, msg);
    throw e;
  }
}
