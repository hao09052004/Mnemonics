/**
 * M5 — re-rank env-var gate at the HTTP boundary.
 *
 * The M5 re-rank step is OFF by default. These tests pin that
 * default behaviour at the route level so a future change that
 * flips the default (or accidentally turns re-rank on) is caught.
 *
 * The "re-rank ON moves hits" test lives in the unit suite at
 * `packages/database/src/__tests__/search-rerank.test.ts`; plumbing
 * per-hit embeddings through the legs is a future change, so the
 * HTTP-level "re-rank ON" path is intentionally not exercised
 * here.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSearchRouter } from '../search.js';

function createSupabaseMock() {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.com' } },
        error: null
      }))
    }
  } as any;
}

function createPoolMock() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    queries,
    async query(sql: string, params: unknown[]) {
      queries.push({ sql, params });
      return {
        rows: [{
          id: '00000000-0000-4000-8000-000000000010',
          type: 'text',
          title: 'Distributed systems notes',
          raw_text: 'retry queues and idempotency',
          ocr_text: null,
          source_url: 'https://example.com/distributed',
          captured_at: new Date('2026-09-25T01:00:00.000Z'),
          score: 0.75
        }],
        rowCount: 1
      };
    }
  };
  return pool;
}

function createAppForSearch(pool: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createSearchRouter({
    pool,
    supabase: createSupabaseMock()
  }));
  return app;
}

describe('POST /api/v1/search — M5 re-rank env gate', () => {
  afterEach(() => {
    delete process.env.SEARCH_RERANK_ENABLED;
    delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
  });

  it('with SEARCH_RERANK_ENABLED unset, returns the same hit order as the pre-M5 path', async () => {
    delete process.env.SEARCH_RERANK_ENABLED;
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: 'idempotency', limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.hits).toHaveLength(1);
    expect(response.body.hits[0].id).toBe('00000000-0000-4000-8000-000000000010');
  });

  it('with SEARCH_RERANK_ENABLED=true, still returns 200 (the env-var is read, not validated)', async () => {
    process.env.SEARCH_RERANK_ENABLED = 'true';
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: 'idempotency', limit: 10 });

    // The re-rank step is wired but is a no-op when no per-hit
    // embeddings are plumbed through (a future change, M7). So
    // the response is byte-equal to the disabled case, which is
    // exactly the contract M5 promises.
    expect(response.status).toBe(200);
    expect(response.body.hits).toHaveLength(1);
    expect(response.body.hits[0].id).toBe('00000000-0000-4000-8000-000000000010');
  });

  // M7 — search result explainability at the HTTP boundary.
  it('with SEARCH_EXPLAINABILITY_ENABLED unset, hits do NOT carry an explanation field', async () => {
    delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: 'idempotency', limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.hits[0].explanation).toBeUndefined();
  });

  it('with SEARCH_EXPLAINABILITY_ENABLED=true, each hit carries an explanation block', async () => {
    process.env.SEARCH_EXPLAINABILITY_ENABLED = 'true';
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: 'idempotency', limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.hits[0].explanation).toBeDefined();
    expect(response.body.hits[0].explanation).toMatchObject({
      lexical: expect.any(Number),
      vector: expect.any(Number),
      chunk: expect.any(Number),
      rrf: expect.any(Number),
      rerank: expect.any(Number)
    });
    delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
  });
});
