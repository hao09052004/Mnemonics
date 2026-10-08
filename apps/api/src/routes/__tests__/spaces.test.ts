/**
 * Spaces HTTP contract.
 *
 * Exercises the router against a fake pool so the assertions are about
 * the *contract* — status codes, validation, ownership scoping, and the
 * request bodies the client depends on — rather than about Postgres.
 * The SQL itself is covered by the database package's integration
 * suite, which runs against a real database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSpaceRouter } from '../spaces.js';
import type { Pool } from 'pg';

const DEV_TOKEN = 'mnemonics-dev-token';
const DEV_USER = '00000000-0000-4000-8000-000000000001';
const OTHER_USER = '00000000-0000-4000-8000-000000000002';

let app: express.Express;
let pool: Pool;
let queries: Array<{ text: string; values?: unknown[] }>;
let handler: (sql: string, values?: unknown[]) => { rows: Record<string, unknown>[] };

/**
 * A tiny query planner for the handful of statements the Spaces
 * repository issues. Anything unexpected returns `[]` rather than
 * throwing, so a route can complete while an assertion catches the
 * drift.
 */
beforeEach(() => {
  queries = [];
  handler = () => ({ rows: [] });

  pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      const result = handler(text, values);
      return { rows: result.rows, rowCount: result.rows.length };
    }),
    connect: vi.fn()
  } as unknown as Pool;

  app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    createSpaceRouter({ pool, expectedToken: DEV_TOKEN, developmentUserId: DEV_USER })
  );
});

afterEach(() => vi.restoreAllMocks());

const auth = (token = DEV_TOKEN) => ({ Authorization: `Bearer ${token}` });

const baseSpace = {
  id: '11111111-1111-1111-1111-111111111111',
  user_id: DEV_USER,
  name: 'M&A Research',
  description: null,
  color: 'blue',
  space_type: 'manual',
  cover_item_id: null,
  rule: null,
  rule_version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

/** Real uuids — the body schema validates them as such. */
const ITEM_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const ITEM_B = 'bbbbbbbb-2222-2222-2222-222222222222';

describe('POST /api/v1/spaces', () => {
  it('creates a manual space', async () => {
    handler = (sql) => (sql.includes('INSERT INTO spaces') ? { rows: [baseSpace] } : { rows: [] });

    const res = await request(app)
      .post('/api/v1/spaces')
      .set(auth())
      .send({ name: 'M&A Research', color: 'blue', spaceType: 'manual' });

    expect(res.status).toBe(201);
    expect(res.body.data.space.spaceType).toBe('manual');
  });

  it('rejects a smart space with no rule', async () => {
    const res = await request(app)
      .post('/api/v1/spaces')
      .set(auth())
      .send({ name: 'Logo', spaceType: 'smart' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SPACE');
  });

  it('rejects a manual space that carries a rule', async () => {
    const res = await request(app)
      .post('/api/v1/spaces')
      .set(auth())
      .send({ name: 'X', spaceType: 'manual', rule: { q: 'logo' } });
    expect(res.status).toBe(400);
  });

  it('rejects a rule with no meaningful criteria', async () => {
    // A Space that matches everything is just a second Everything view.
    const res = await request(app)
      .post('/api/v1/spaces')
      .set(auth())
      .send({ name: 'Everything', spaceType: 'smart', rule: { q: '' } });
    expect(res.status).toBe(400);
  });

  it('rejects a colour outside the curated palette', async () => {
    const res = await request(app)
      .post('/api/v1/spaces')
      .set(auth())
      .send({ name: 'Neon', spaceType: 'manual', color: '#ff00ff' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown item type in the rule', async () => {
    const res = await request(app)
      .post('/api/v1/spaces')
      .set(auth())
      .send({ name: 'X', spaceType: 'smart', rule: { q: 'a', filters: { kind: ['video'] } } });
    expect(res.status).toBe(400);
  });

  it('accepts a smart space whose kind filter is document-only', async () => {
    handler = (sql) =>
      sql.includes('INSERT INTO spaces')
        ? {
            rows: [
              {
                ...baseSpace,
                space_type: 'smart',
                rule: { q: 'valuation', filters: { kind: ['document'] } }
              }
            ]
          }
        : { rows: [] };

    const res = await request(app)
      .post('/api/v1/spaces')
      .set(auth())
      .send({
        name: 'Valuation PDFs',
        spaceType: 'smart',
        rule: { q: 'valuation', filters: { kind: ['document'] } }
      });
    expect(res.status).toBe(201);
    expect(res.body.data.space.rule.filters.kind).toEqual(['document']);
  });

  it('requires a session', async () => {
    const res = await request(app).post('/api/v1/spaces').send({ name: 'X', spaceType: 'manual' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/spaces/from-search', () => {
  it('stores the criteria on a smart space', async () => {
    handler = (sql) =>
      sql.includes('INSERT INTO spaces')
        ? { rows: [{ ...baseSpace, space_type: 'smart', rule: { q: 'logo' } }] }
        : { rows: [] };

    const res = await request(app)
      .post('/api/v1/spaces/from-search')
      .set(auth())
      .send({ name: 'Logo Inspiration', color: 'teal', rule: { q: 'logo' } });

    expect(res.status).toBe(201);
    expect(res.body.data.space.rule).toEqual({ q: 'logo' });

    // The rule is persisted as criteria, never as result ids.
    const insert = queries.find((q) => q.text.includes('INSERT INTO spaces'));
    expect(JSON.parse(String(insert!.values![6]))).toEqual({ q: 'logo' });
  });

  it('refuses to create a manual space through this route', async () => {
    const res = await request(app)
      .post('/api/v1/spaces/from-search')
      .set(auth())
      .send({ name: 'X', spaceType: 'manual' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/spaces', () => {
  it('scopes the query to the authenticated user', async () => {
    handler = () => ({ rows: [baseSpace] });
    await request(app).get('/api/v1/spaces').set(auth());
    const list = queries.find((q) => q.text.includes('FROM spaces s'));
    expect(list?.values).toEqual([DEV_USER]);
  });

  it('leaves smart counts unresolved unless withCounts is requested', async () => {
    handler = (sql) =>
      sql.includes('FROM spaces s')
        ? { rows: [{ ...baseSpace, space_type: 'smart', rule: { q: 'logo' }, item_count: null }] }
        : { rows: [] };

    const res = await request(app).get('/api/v1/spaces').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.spaces[0].itemCount).toBeNull();
  });
});

describe('PATCH /api/v1/spaces/:id', () => {
  it('renames and recolours', async () => {
    handler = (sql) =>
      sql.includes('UPDATE spaces') ? { rows: [{ ...baseSpace, name: 'Renamed', color: 'rose' }] } : { rows: [] };

    const res = await request(app)
      .patch(`/api/v1/spaces/${baseSpace.id}`)
      .set(auth())
      .send({ name: 'Renamed', color: 'rose' });

    expect(res.status).toBe(200);
    expect(res.body.data.space.name).toBe('Renamed');
    expect(res.body.data.space.color).toBe('rose');
  });

  it('rejects an empty patch', async () => {
    const res = await request(app)
      .patch(`/api/v1/spaces/${baseSpace.id}`)
      .set(auth())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for a space the caller does not own', async () => {
    handler = () => ({ rows: [] });
    const res = await request(app)
      .patch(`/api/v1/spaces/${baseSpace.id}`)
      .set(auth())
      .send({ name: 'hijack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/spaces/:id', () => {
  it('deletes the space and never the items', async () => {
    handler = (sql) => (sql.includes('DELETE FROM spaces') ? { rows: [{}] } : { rows: [] });

    const res = await request(app).delete(`/api/v1/spaces/${baseSpace.id}`).set(auth());
    expect(res.status).toBe(204);

    // The only statement issued is against `spaces`.
    const deletes = queries.filter((q) => q.text.includes('DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].text).toContain('DELETE FROM spaces');
    expect(deletes[0].text).not.toContain('items');
  });

  it('returns 404 for a space the caller does not own', async () => {
    handler = () => ({ rows: [] });
    const res = await request(app).delete(`/api/v1/spaces/${baseSpace.id}`).set(auth());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/spaces/:id/items', () => {
  it('adds many items and reports the skipped ones', async () => {
    handler = (sql) => {
      if (sql.includes('SELECT space_type')) return { rows: [{ space_type: 'manual' }] };
      if (sql.includes('INSERT INTO space_items')) return { rows: [{ item_id: ITEM_B }] };
      return { rows: [] };
    };

    const res = await request(app)
      .post(`/api/v1/spaces/${baseSpace.id}/items`)
      .set(auth())
      .send({ itemIds: [ITEM_A, ITEM_B] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ added: [ITEM_B], skipped: [ITEM_A] });
  });

  it('rejects a manual add to a smart space with 422', async () => {
    handler = (sql) =>
      sql.includes('SELECT space_type') ? { rows: [{ space_type: 'smart' }] } : { rows: [] };

    const res = await request(app)
      .post(`/api/v1/spaces/${baseSpace.id}/items`)
      .set(auth())
      .send({ itemIds: [ITEM_A] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SPACE_NOT_MANUAL');
    // No membership write was attempted.
    expect(queries.some((q) => q.text.includes('INSERT INTO space_items'))).toBe(false);
  });

  it('rejects a single-item body, since the shape is itemIds', async () => {
    const res = await request(app)
      .post(`/api/v1/spaces/${baseSpace.id}/items`)
      .set(auth())
      .send({ itemId: ITEM_A });
    expect(res.status).toBe(400);
  });

  it('rejects an empty list', async () => {
    const res = await request(app)
      .post(`/api/v1/spaces/${baseSpace.id}/items`)
      .set(auth())
      .send({ itemIds: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a non-uuid id', async () => {
    const res = await request(app)
      .post(`/api/v1/spaces/${baseSpace.id}/items`)
      .set(auth())
      .send({ itemIds: ['not-a-uuid'] });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/spaces/:id/items/:itemId', () => {
  it('returns 204 for a real membership', async () => {
    handler = (sql) => (sql.includes('DELETE FROM space_items') ? { rows: [{}] } : { rows: [] });
    const res = await request(app)
      .delete(`/api/v1/spaces/${baseSpace.id}/items/${ITEM_A}`)
      .set(auth());
    expect(res.status).toBe(204);
  });

  it('never deletes the memory itself', async () => {
    handler = (sql) => (sql.includes('DELETE FROM space_items') ? { rows: [{}] } : { rows: [] });
    await request(app).delete(`/api/v1/spaces/${baseSpace.id}/items/${ITEM_A}`).set(auth());
    const deleteSql = queries.find((q) => q.text.includes('DELETE'))!.text;
    expect(deleteSql).toContain('space_items');
    expect(deleteSql).not.toMatch(/DELETE FROM items/);
  });

  it('returns 404 when the item is not a member', async () => {
    handler = () => ({ rows: [] });
    const res = await request(app)
      .delete(`/api/v1/spaces/${baseSpace.id}/items/${ITEM_A}`)
      .set(auth());
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/spaces/:id/items', () => {
  it('returns persisted ids for a manual space', async () => {
    handler = (sql) => {
      if (sql.includes('FROM spaces s')) return { rows: [{ ...baseSpace, item_count: 2 }] };
      if (sql.includes('FROM space_items')) return { rows: [{ id: 'i1' }, { id: 'i2' }] };
      return { rows: [] };
    };

    const res = await request(app).get(`/api/v1/spaces/${baseSpace.id}/items`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('manual');
    expect(res.body.data.ids).toEqual(['i1', 'i2']);
  });

  it('resolves a smart space through the search service', async () => {
    handler = (sql) => {
      if (sql.includes('FROM spaces s'))
        return { rows: [{ ...baseSpace, space_type: 'smart', rule: { q: 'logo' } }] };
      return { rows: [] };
    };

    const res = await request(app).get(`/api/v1/spaces/${baseSpace.id}/items`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('smart');
    // A smart space runs the same lexical query the search endpoint
    // runs — that shared code path is what keeps the two results equal.
    const searchSql = queries.find((q) => q.text.includes('to_tsquery'));
    expect(searchSql).toBeDefined();
    expect(searchSql!.values).toContain('logo');
  });
});

describe('authentication', () => {
  it('rejects a missing token on every mutating route', async () => {
    handler = () => ({ rows: [baseSpace] });
    const id = baseSpace.id;
    await request(app).post('/api/v1/spaces').send({ name: 'X', spaceType: 'manual' }).expect(401);
    await request(app).patch(`/api/v1/spaces/${id}`).send({ name: 'X' }).expect(401);
    await request(app).delete(`/api/v1/spaces/${id}`).expect(401);
    await request(app)
      .post(`/api/v1/spaces/${id}/items`)
      .send({ itemIds: ['i1'] })
      .expect(401);
    await request(app).delete(`/api/v1/spaces/${id}/items/i1`).expect(401);
  });
});

describe('ownership', () => {
  it('binds the user from the session, so a body field cannot widen it', async () => {
    handler = (sql) => {
      if (sql.includes('SELECT space_type')) return { rows: [{ space_type: 'manual' }] };
      if (sql.includes('INSERT INTO space_items')) return { rows: [{ item_id: 'item-1' }] };
      return { rows: [] };
    };

    await request(app)
      .post(`/api/v1/spaces/${baseSpace.id}/items`)
      .set(auth())
      // A spoofed userId in the body must be ignored entirely.
      .send({ itemIds: [ITEM_A], userId: OTHER_USER });

    const insert = queries.find((q) => q.text.includes('INSERT INTO space_items'));
    expect(insert?.values).toContain(DEV_USER);
    expect(insert?.values).not.toContain(OTHER_USER);
  });
});
