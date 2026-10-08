/**
 * Auto-link similar items.
 *
 * For a freshly-embedded item, find the closest READY memories
 * owned by the same user and persist a `similar` edge in each
 * direction.
 *
 * Identity safety (Milestone 1 of the AI Quality upgrade):
 *   Every edge records the embedding identity (model, dimensions,
 *   version) that produced the score. The SQL guard
 *   `embeddings_compatible()` rejects comparisons across different
 *   identities, so a row written by Gemini cannot be compared
 *   against a row written by a local Ollama model even if both
 *   happen to have the same numeric width.
 *
 *   The source identity is read from `item_embeddings` (the actual
 *   row that the embed handler wrote) — never from a hard-coded
 *   string and never from `process.env`. If the source row is
 *   `legacy` or `noop`, the function refuses to build edges: a
 *   synthetic neighbour is worse than no neighbour.
 */

import type { Pool } from 'pg';

export interface AutoLinkOptions {
  threshold?: number;
  limit?: number;
}

export interface SimilarItem {
  id: string;
  similarity: number;
  embeddingModel: string;
  embeddingVersion: string;
}

const DEFAULT_THRESHOLD = 0.78;
const DEFAULT_LIMIT = 5;
const ALGORITHM_VERSION = 'autolink-v1.0.0';

interface SourceIdentity {
  model: string;
  dimensions: number;
  version: string;
}

export async function autoLinkSimilarItems(
  pool: Pool,
  userId: string,
  itemId: string,
  options: AutoLinkOptions = {}
): Promise<SimilarItem[]> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const limit = options.limit ?? DEFAULT_LIMIT;

  // 1. Resolve the source identity. Refuse to run if the source
  //    row is missing, legacy, or noop — every comparison that
  //    follows would be unsafe.
  const source = await loadSourceIdentity(pool, itemId, userId);
  if (!source) {
    return [];
  }

  // 2. Build the cross-model-safe join. The subquery on the
  //    right-hand side filters to rows whose identity matches the
  //    source exactly (model + dimensions + version) and which
  //    belong to the same user. Legacy / noop rows are excluded by
  //    the `embedding_kind = 'real'` predicate, which the planner
  //    can satisfy from `item_embeddings_identity_idx` (migration
  //    022).
  const result = await pool.query<{ id: string; similarity: number }>(
    `SELECT
       target.id,
       (1 - (source.embedding <=> target.embedding))::float8 AS similarity
     FROM item_embeddings source
     JOIN items source_item
       ON source_item.id = source.item_id
      AND source_item.user_id = $1
      AND source_item.status = 'ready'
     JOIN item_embeddings target
       ON target.item_id <> source.item_id
      AND target.embedding_kind = 'real'
      AND target.model = source.model
      AND target.dimensions = source.dimensions
      AND target.embedding_version = source.embedding_version
     JOIN items target_item
       ON target_item.id = target.item_id
      AND target_item.user_id = $1
      AND target_item.status = 'ready'
     WHERE source.item_id = $2
       AND source.embedding_kind = 'real'
       AND (1 - (source.embedding <=> target.embedding)) >= $3
     ORDER BY source.embedding <=> target.embedding
     LIMIT $4`,
    [userId, itemId, threshold, limit]
  );

  // 3. Persist edges. The new `embedding_identity` column on
  //    `item_edges` is the source of truth; the JSON attribute is
  //    kept only for downstream tools that still read it.
  for (const similar of result.rows) {
    const weight = Math.max(0, Math.min(1, Number(similar.similarity)));
    const identity = `${source.model}|${source.dimensions}|${source.version}`;

    await pool.query(
      `INSERT INTO item_edges
        (user_id, from_item_id, to_item_id, edge_type, weight,
         attributes, embedding_model, algorithm_version, embedding_identity)
       VALUES
        ($1, $2, $3, 'similar', $4, $5, $6, $7, $8),
        ($1, $3, $2, 'similar', $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, from_item_id, to_item_id, edge_type)
       DO UPDATE SET
         weight = EXCLUDED.weight,
         attributes = EXCLUDED.attributes,
         embedding_model = EXCLUDED.embedding_model,
         algorithm_version = EXCLUDED.algorithm_version,
         embedding_identity = EXCLUDED.embedding_identity`,
      [
        userId,
        itemId,
        similar.id,
        weight,
        JSON.stringify({
          source: 'embedding',
          model: source.model,
          dimensions: source.dimensions,
          embeddingVersion: source.version,
          algorithmVersion: ALGORITHM_VERSION,
          threshold,
        }),
        source.model,
        ALGORITHM_VERSION,
        identity,
      ]
    );
  }

  return result.rows.map((row) => ({
    id: row.id,
    similarity: Number(row.similarity),
    embeddingModel: source.model,
    embeddingVersion: source.version,
  }));
}

/**
 * Read the source embedding identity. Returns `null` when the
 * source row is missing, owned by a different user, or stamped
 * with a non-`real` kind. The caller is expected to abort in
 * that case — building edges from a synthetic vector is worse
 * than no edges.
 */
async function loadSourceIdentity(
  pool: Pool,
  itemId: string,
  userId: string,
): Promise<SourceIdentity | null> {
  const result = await pool.query<{
    model: string;
    dimensions: number;
    embedding_version: string;
    embedding_kind: string;
    user_id: string;
  }>(
    `SELECT ie.model, ie.dimensions, ie.embedding_version,
            ie.embedding_kind, i.user_id
       FROM item_embeddings ie
       JOIN items i ON i.id = ie.item_id
      WHERE ie.item_id = $1
      LIMIT 1`,
    [itemId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.user_id !== userId) return null;
  if (row.embedding_kind !== 'real') return null;
  if (!row.model || !row.embedding_version) return null;
  return {
    model: row.model,
    dimensions: Number(row.dimensions),
    version: row.embedding_version,
  };
}
