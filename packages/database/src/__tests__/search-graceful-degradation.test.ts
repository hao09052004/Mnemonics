/**
 * runSearch — graceful degradation when the query embedding provider
 * throws.
 *
 * Contract: a query embedding failure (network timeout, 5xx from
 * Gemini, ProviderError with code RATE_LIMITED / PROVIDER_UNAVAILABLE,
 * malformed response) MUST NOT take the whole search down. The
 * semantic + chunk legs return [], the lexical leg still returns
 * its rows, and the response is 200 with whatever the lexical leg
 * found. A search that 500s because Gemini is having a bad minute
 * is a worse user experience than a slower lexical search.
 *
 * Without this guard the search route 500s in production whenever
 * the embedding provider hiccups, even though the user only asked
 * for "anything matching this query" and the lexical leg has the
 * answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPool, runSearch, type EmbeddingLike } from '@mnemonics/database';
import type { Pool } from 'pg';
import { DATABASE_URL } from './setup.js';

const skipIfNoDb = !DATABASE_URL;

const failingGemini: EmbeddingLike = {
  info: () => ({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 1024 }),
  embedOne: () => {
    // Simulate a Gemini Free-Tier 429 or a network timeout. The
    // shape of the error is irrelevant — the contract is "any
    // throw degrades to lexical-only".
    const err = new Error('Gemini returned 429: rate limit exceeded') as Error & {
      code: string;
      provider: string;
    };
    err.code = 'RATE_LIMITED';
    err.provider = 'gemini';
    return Promise.reject(err);
  }
};

const networkTimeout: EmbeddingLike = {
  info: () => ({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 1024 }),
  embedOne: () => Promise.reject(new Error('aborted'))
};

const returningEmpty: EmbeddingLike = {
  info: () => ({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 1024 }),
  embedOne: () => Promise.resolve([] as number[])
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

describe.skipIf(skipIfNoDb)('runSearch — query embedding graceful degradation', () => {
  let pool: Pool;
  let userId: string;
  let itemIds: string[] = [];
  // Silence the expected warning lines so the test output stays clean.
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    pool = createPool(DATABASE_URL!);
    userId = await createUser(pool, `degrade-search-${Date.now()}@example.com`);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    if (itemIds.length > 0) {
      await pool.query(`DELETE FROM items WHERE id = ANY($1::uuid[])`, [itemIds]);
      itemIds = [];
    }
    await pool.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [userId]);
    await pool.end();
    warnSpy.mockRestore();
  });

  it('returns lexical hits when embedOne throws a ProviderError', async () => {
    const id = await createReadyTextItem(
      pool,
      userId,
      'Idempotency guarantees for offline capture',
      'Idempotency keys make browser capture reliable'
    );
    itemIds.push(id);

    const result = await runSearch(
      { pool, embeddings: failingGemini },
      userId,
      { q: 'idempotency', limit: 10 }
    );

    expect(result.hits.map((h) => h.id)).toContain(id);
    // The operator should see exactly one warning per failed
    // search, with the provider name and error code visible.
    const degradeWarning = warnSpy.mock.calls
      .map((args) => String(args[0] ?? ''))
      .find((line) => line.includes('[search-service] query embedding failed'));
    expect(degradeWarning).toBeDefined();
    expect(degradeWarning).toContain('provider=gemini');
    expect(degradeWarning).toContain('code=RATE_LIMITED');
  });

  it('returns lexical hits when embedOne rejects with a generic Error (network timeout)', async () => {
    const id = await createReadyTextItem(
      pool,
      userId,
      'Capture pipeline reaches ready',
      'pipeline reaches ready'
    );
    itemIds.push(id);

    const result = await runSearch(
      { pool, embeddings: networkTimeout },
      userId,
      { q: 'pipeline', limit: 10 }
    );

    expect(result.hits.map((h) => h.id)).toContain(id);
  });

  it('returns lexical hits when embedOne resolves to an empty array', async () => {
    const id = await createReadyTextItem(
      pool,
      userId,
      'Tag generation service degraded gracefully',
      'tag generation degraded gracefully'
    );
    itemIds.push(id);

    const result = await runSearch(
      { pool, embeddings: returningEmpty },
      userId,
      { q: 'degraded', limit: 10 }
    );

    expect(result.hits.map((h) => h.id)).toContain(id);
  });

  it('does not throw when the provider fails on the first call and the user retries with the same query', async () => {
    // The in-memory embedding cache must NOT cache a failed call,
    // otherwise a transient Gemini outage would persist for the
    // life of the process even after Gemini recovers.
    const id = await createReadyTextItem(
      pool,
      userId,
      'Search robustness against provider flakes',
      'search robustness against provider flakes'
    );
    itemIds.push(id);

    // First call: fail
    const failing: EmbeddingLike = {
      info: () => ({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 1024 }),
      embedOne: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'PROVIDER_UNAVAILABLE' }))
        .mockResolvedValueOnce([0.1, 0.2, 0.3])
    };

    const r1 = await runSearch(
      { pool, embeddings: failing },
      userId,
      { q: 'robustness', limit: 10 }
    );
    expect(r1.hits.map((h) => h.id)).toContain(id);

    // Second call: succeed. The mock contract proves the second
    // embedOne was actually invoked (not served from a poisoned
    // cache of the first failure).
    const r2 = await runSearch(
      { pool, embeddings: failing },
      userId,
      { q: 'robustness', limit: 10 }
    );
    expect(r2.hits.map((h) => h.id)).toContain(id);
    expect((failing.embedOne as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
