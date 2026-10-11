/**
 * runSearch — Noop embedding guard.
 *
 * Mirrors the Noop guard in
 * `apps/api/src/jobs/handlers/embed.ts`: when the configured
 * embedding provider is a Noop (neither Gemini nor a local model is
 * usable), runSearch must NOT call embedOne (which throws) and must
 * NOT invent a vector. The semantic + chunk legs return [], and the
 * lexical leg still returns its rows. A search that previously 500'd
 * in CI demo (and any local dev without GEMINI_API_KEY) now degrades
 * to lexical-only — same visible, correct behaviour the embed
 * handler already promises.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPool, runSearch, type EmbeddingLike } from '@mnemonics/database';
import type { Pool } from 'pg';
import { DATABASE_URL } from './setup.js';

const skipIfNoDb = !DATABASE_URL;

const noopEmbeddings: EmbeddingLike = {
  info: () => ({ name: 'noop', model: 'none', dimensions: 1024 }),
  embedOne: () => {
    throw new Error(
      'NoopEmbeddingProvider.embedOne must NOT be called when guard fires'
    );
  }
};

const fallbackEmbeddings: EmbeddingLike = {
  info: () => ({ name: 'gemini+noop', model: 'gemini-embedding-001', dimensions: 1024 }),
  embedOne: () => {
    throw new Error(
      'FallingBackEmbeddingProvider.embedOne must NOT be called when guard fires'
    );
  }
};

async function createUser(pool: Pool, email: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return String(res.rows[0].id);
}

async function createReadyTextItem(
  pool: Pool,
  userId: string,
  title: string,
  rawText: string
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO items (user_id, type, title, raw_text, captured_at, status, client_request_id)
     VALUES ($1, 'text', $2, $3, NOW(), 'ready', gen_random_uuid())
     RETURNING id`,
    [userId, title, rawText]
  );
  return String(res.rows[0].id);
}

describe.skipIf(skipIfNoDb)('runSearch — Noop embedding guard', () => {
  let pool: Pool;
  let userId: string;
  let itemIds: string[] = [];

  beforeEach(async () => {
    pool = createPool(DATABASE_URL!);
    userId = await createUser(pool, `noop-search-${Date.now()}@example.com`);
  });

  afterEach(async () => {
    if (itemIds.length > 0) {
      await pool.query(`DELETE FROM items WHERE id = ANY($1::uuid[])`, [itemIds]);
      itemIds = [];
    }
    await pool.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [userId]);
    await pool.end();
  });

  it('returns lexical hits when embeddings provider is Noop', async () => {
    const id = await createReadyTextItem(
      pool,
      userId,
      'Idempotency guarantees for offline capture',
      'Idempotency keys make browser capture reliable'
    );
    itemIds.push(id);

    const result = await runSearch(
      { pool, embeddings: noopEmbeddings },
      userId,
      { q: 'idempotency', limit: 10 }
    );

    expect(result.hits.map((h) => h.id)).toContain(id);
  });

  it('returns lexical hits when embeddings provider is a Noop fallback chain (gemini+noop)', async () => {
    const id = await createReadyTextItem(
      pool,
      userId,
      'Capture pipeline reaches ready',
      'pipeline reaches ready'
    );
    itemIds.push(id);

    const result = await runSearch(
      { pool, embeddings: fallbackEmbeddings },
      userId,
      { q: 'pipeline', limit: 10 }
    );

    expect(result.hits.map((h) => h.id)).toContain(id);
  });

  it('does not throw when the Noop provider is asked for the query vector', async () => {
    await expect(
      runSearch(
        { pool, embeddings: noopEmbeddings },
        userId,
        { q: 'anything', limit: 10 }
      )
    ).resolves.toBeDefined();
  });
});
