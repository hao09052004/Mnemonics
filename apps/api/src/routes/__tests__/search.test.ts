import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
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

describe('search route', () => {
  it('returns lexical results for ready items with tag and kind filters', async () => {
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({
        q: 'idempotency',
        filters: {
          tags: ['Backend APIs'],
          kind: ['text']
        },
        limit: 10
      });

    expect(response.status).toBe(200);
    expect(response.body.hits).toHaveLength(1);
    expect(response.body.hits[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000010',
      kind: 'text',
      title: 'Distributed systems notes'
    });

    const lexicalQuery = pool.queries[0];
    expect(lexicalQuery.sql).toContain("i.status = 'ready'");
    expect(lexicalQuery.sql).toContain('item_tags');
    expect(lexicalQuery.sql).toContain('t.normalized_name = ANY');
    expect(lexicalQuery.params).toContainEqual(['backend-apis']);
  });

  it('rejects a request with neither text nor filters', async () => {
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_SEARCH_REQUEST');
  });

  // Regression (2026-10-04): the filter chips send a filter-only request.
  // `q` used to be z.string().min(1), so selecting a chip with an empty
  // search box returned 400 and the chip could never narrow the grid.
  it('accepts a filter-only request and drops the text-match clause', async () => {
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: '', filters: { kind: ['screenshot'] }, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.hits).toHaveLength(1);

    const lexicalQuery = pool.queries[0];
    // The `@@ plainto_tsquery` predicate must be absent: an empty tsquery
    // has zero nodes and matches no row, which silently emptied the grid.
    expect(lexicalQuery.sql).not.toContain('@@ plainto_tsquery');
    expect(lexicalQuery.sql).toContain('i.type = ANY');
    expect(lexicalQuery.params).toContainEqual(['screenshot']);

    // Regression: with the @@ clause gone the query text is no longer bound,
    // so an extra '' parameter made Postgres reject the whole statement with
    // "could not determine data type of parameter $2" (HTTP 500). The
    // placeholder count and the params array must stay in lockstep.
    const placeholders = [...lexicalQuery.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const highest = Math.max(...placeholders);
    expect(lexicalQuery.params).toHaveLength(highest);
  });

  it('rejects a blank-but-whitespace query with no filters', async () => {
    const pool = createPoolMock();
    const app = createAppForSearch(pool);

    const response = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_SEARCH_REQUEST');
  });

  it('supports development-token auth for the local demo', async () => {
    const pool = createPoolMock();
    const app = express();
    app.use('/api/v1', createSearchRouter({
      pool,
      expectedToken: 'demo-token',
      developmentUserId: '00000000-0000-4000-8000-000000000001'
    }));

    const response = await request(app)
      .get('/api/v1/search?q=idempotency')
      .set('Authorization', 'Bearer demo-token');

    expect(response.status).toBe(200);
    expect(response.body.hits).toHaveLength(1);
  });

});
