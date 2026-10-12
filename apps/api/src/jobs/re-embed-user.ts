/**
 * M8 — re_embed_user count contract.
 *
 * `re_embed_user` is a SQL function in migration
 * `024_embedding_model_migration.sql`. It returns the
 * number of `ready` items for a user whose
 * `embedding_model` differs from the target. The actual
 * re-embed is an orchestration step that calls this
 * function once for the count, then enqueues one
 * `embed` job per item with `targetEmbeddingModel` in
 * the payload.
 *
 * This module is the JS-side helper that wraps the
 * function call. It is *count-only* — it does not
 * write to the `jobs` table.
 */

export interface ReEmbedUserPool {
  query: (
    sql: string,
    params: unknown[]
  ) => Promise<{ rows: Array<{ count: number | string }>; rowCount: number }>;
}

export async function reEmbedUserCount(
  pool: ReEmbedUserPool,
  userId: string,
  targetModel: string
): Promise<number> {
  const result = await pool.query(
    `SELECT re_embed_user($1::uuid, $2::text) AS count`,
    [userId, targetModel]
  );
  const raw = result.rows[0]?.count;
  return typeof raw === 'string' ? Number(raw) : Number(raw ?? 0);
}
