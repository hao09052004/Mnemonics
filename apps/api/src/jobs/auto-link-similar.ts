import type { Pool } from 'pg';

export interface AutoLinkOptions {
  threshold?: number;
  limit?: number;
}

export interface SimilarItem {
  id: string;
  similarity: number;
}

const DEFAULT_THRESHOLD = 0.78;
const DEFAULT_LIMIT = 5;

/**
 * Create similarity edges from a newly embedded item to the closest
 * READY memories owned by the same user.
 *
 * This deliberately runs only for production OpenAI embeddings. Mock
 * development embeddings are deterministic by text length and are not
 * meaningful for semantic relationships.
 */
export async function autoLinkSimilarItems(
  pool: Pool,
  userId: string,
  itemId: string,
  options: AutoLinkOptions = {}
): Promise<SimilarItem[]> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const result = await pool.query<{ id: string; similarity: number }>(
    `SELECT
       target.id,
       (1 - (source_embedding.embedding <=> target_embedding.embedding))::float8 AS similarity
     FROM item_embeddings source_embedding
     JOIN items source_item
       ON source_item.id = source_embedding.item_id
      AND source_item.user_id = $1
      AND source_item.status = 'ready'
     JOIN item_embeddings target_embedding
       ON target_embedding.item_id <> source_embedding.item_id
     JOIN items target
       ON target.id = target_embedding.item_id
      AND target.user_id = $1
      AND target.status = 'ready'
     WHERE source_embedding.item_id = $2
       AND (1 - (source_embedding.embedding <=> target_embedding.embedding)) >= $3
     ORDER BY source_embedding.embedding <=> target_embedding.embedding
     LIMIT $4`,
    [userId, itemId, threshold, limit]
  );

  for (const similar of result.rows) {
    const weight = Math.max(0, Math.min(1, Number(similar.similarity)));

    await pool.query(
      `INSERT INTO item_edges
        (user_id, from_item_id, to_item_id, edge_type, weight, attributes)
       VALUES
        ($1, $2, $3, 'similar', $4, $5),
        ($1, $3, $2, 'similar', $4, $5)
       ON CONFLICT (user_id, from_item_id, to_item_id, edge_type)
       DO UPDATE SET
         weight = EXCLUDED.weight,
         attributes = EXCLUDED.attributes`,
      [
        userId,
        itemId,
        similar.id,
        weight,
        JSON.stringify({
          source: 'embedding',
          model: 'text-embedding-3-small',
          threshold
        })
      ]
    );
  }

  return result.rows.map(row => ({
    id: row.id,
    similarity: Number(row.similarity)
  }));
}
