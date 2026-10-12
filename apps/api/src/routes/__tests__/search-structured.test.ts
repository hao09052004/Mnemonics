/**
 * M3 — query parser wired into the search route.
 *
 * Confirms that a natural-language `q` produces a SQL query
 * that filters by `item_classifications.detected_type` and
 * that structured tokens propagate to the JSONB attributes
 * lookups. The fake pool records every SQL the route emits.
 */
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

function makePoolStub(queries: Array<{ sql: string; params: unknown[] }>) {
  return {
    queries,
    async query(sql: string, params: unknown[]) {
      queries.push({ sql, params });
      return { rows: [] };
    }
  } as any;
}

function buildApp(queries: Array<{ sql: string; params: unknown[] }>) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    createSearchRouter({
      pool: makePoolStub(queries),
      supabase: createSupabaseMock()
    })
  );
  return app;
}

describe('Search route (M3) — natural query parsing', () => {
  it('parses "recipes this week" into a structured detectedType + date window', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const app = buildApp(queries);
    const res = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: 'recipes this week' });
    expect(res.status).toBe(200);
    // The structured leg must have been issued with the recipe filter.
    const structLeg = queries.find(q =>
      q.sql.includes('item_classifications') &&
      q.sql.includes("detected_type = ANY")
    );
    expect(structLeg).toBeDefined();
    expect(structLeg!.params).toEqual(
      expect.arrayContaining([expect.arrayContaining(['recipe'])])
    );
    // The captured_after ISO string is set.
    const lexLeg = queries.find(q => q.sql.includes("to_tsvector('simple'"));
    expect(lexLeg).toBeDefined();
    const captured = lexLeg!.params.find(
      (p): p is string => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(p)
    );
    expect(captured).toBeDefined();
  });

  it('parses "brand:ikea material:wood" into attribute filters', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const app = buildApp(queries);
    const res = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: 'brand:ikea material:wood' });
    expect(res.status).toBe(200);
    // The structured leg must use JSONB attribute lookups.
    const structLeg = queries.find(q =>
      q.sql.includes('item_classifications') &&
      q.sql.includes('attributes->>')
    );
    expect(structLeg).toBeDefined();
    // The parameter list must include the 'ikea' and 'wood' values
    // (the key and value are sent as separate parameters).
    const allParams = structLeg!.params.map(String);
    expect(allParams).toEqual(expect.arrayContaining(['ikea', 'wood']));
  });

  it('exposes STRUCT_WEIGHT in the response explain payload', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const app = buildApp(queries);
    const res = await request(app)
      .post('/api/v1/search')
      .set('Authorization', 'Bearer test-token')
      .send({ q: 'recipes this week', explain: true });
    expect(res.status).toBe(200);
    expect(res.body.explain_data).toBeDefined();
    expect(res.body.explain_data.weights.struct).toBe(0.5);
    expect(res.body.explain_data.weights.lex).toBe(0.4);
    expect(res.body.explain_data.weights.sem).toBe(0.6);
  });
});
