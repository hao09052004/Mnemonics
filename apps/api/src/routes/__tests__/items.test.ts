/**
 * Tests for the GET /api/v1/items route — the dashboard list endpoint
 * shared by the React web dashboard and the browser extension.
 *
 * Verifies the contract the two clients both rely on:
 *   - Response is wrapped in `{ data: { items, total, limit, offset } }`.
 *   - Each item carries `kind` (= legacy `type`), `tags`, and an
 *     `image_url` (signed URL from storage when available).
 *   - Items are filtered by `user_id` — no cross-tenant leakage.
 *
 * DELETE lives in this file too. The route opens a real transaction via
 * `pool.connect()`, so those tests use a fake pool that models a
 * transactional client (BEGIN / COMMIT / ROLLBACK) and records every
 * statement — enough to prove the cleanup fan-out and atomicity without
 * a live database.
 */
import request from 'supertest';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createItemRouter } from '../items.js';

interface FakeRow {
  id: string;
  type: string;
  title: string;
  source_url: string | null;
  raw_text: string | null;
  ocr_text: string | null;
  status: string;
  captured_at: string;
  created_at: string;
  updated_at: string;
  is_favorite?: boolean;
  asset_storage_key: string | null;
}

interface FakeRepoItem {
  id: string;
  userId: string;
  status: string;
  type: string;
  title: string;
  sourceUrl?: string | null;
  rawText?: string | null;
  ocrText?: string | null;
  ocrEngine?: string | null;
  ocrConfidence?: number | null;
  capturedAt: Date;
}

function createFakePool(rows: FakeRow[], tagMap: Record<string, string[]> = {}) {
  const ownerMap: Record<string, string> = (rows as any).__owner || {};
  return {
    async query<T = unknown>(sql: string, params: unknown[] = []) {
      const lower = sql.toLowerCase().trim();
      if (lower.startsWith('select id, type, title, source_url')) {
        const userId = params[0];
        const favoritesOnly = params[3] === true;
        const filtered = rows
          .filter((r) => !ownerMap[r.id] || ownerMap[r.id] === userId)
          .filter((r) => !favoritesOnly || r.is_favorite === true);
        return { rows: filtered };
      }
      if (lower.startsWith('select it.item_id::text')) {
        const itemIds = (params[0] as string[]) || [];
        const out: { item_id: string; name: string }[] = [];
        for (const id of itemIds) {
          for (const name of tagMap[id] || []) {
            out.push({ item_id: id, name });
          }
        }
        return { rows: out };
      }
      if (lower.startsWith('select count(*)')) {
        const userId = params[0];
        const favoritesOnly = params[1] === true;
        const filtered = rows
          .filter((r) => !ownerMap[r.id] || ownerMap[r.id] === userId)
          .filter((r) => !favoritesOnly || r.is_favorite === true);
        return { rows: [{ count: String(filtered.length) }] };
      }
      if (lower.startsWith('update items set is_favorite')) {
        const isFav = params[0];
        const itemId = params[1];
        const row = rows.find((r) => r.id === itemId);
        if (row) row.is_favorite = !!isFav;
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query() { return { rows: [], rowCount: 0 }; },
        release() { /* no-op */ }
      };
    }
  } as any;
}

interface FakePoolCall {
  sql: string;
  params: unknown[];
}

/**
 * Fake pool that records every statement so the DELETE test can assert
 * the full cleanup fan-out, and models a transactional client
 * (BEGIN / COMMIT / ROLLBACK) so we can also prove the delete is
 * atomic and rolls back on failure.
 */
function createDeleteFakePool(
  options: {
    /** Rows deleted by `DELETE FROM items`. */
    itemRowsAffected?: number;
    /** Throw on this statement to force a ROLLBACK. */
    failOn?: string;
  } = {}
) {
  const calls: FakePoolCall[] = [];
  const { itemRowsAffected = 1, failOn } = options;

  const record = (sql: string, params: unknown[] = []) => {
    calls.push({ sql: sql.toLowerCase().trim(), params });
    if (failOn && sql.toLowerCase().includes(failOn)) {
      throw new Error(`forced failure on ${failOn}`);
    }
  };

  const runTransaction = async (sql: string, params: unknown[] = []) => {
    record(sql, params);
    if (sql.toLowerCase().includes('delete from items')) {
      return { rows: [], rowCount: itemRowsAffected };
    }
    return { rows: [], rowCount: 1 };
  };

  return {
    calls,
    async query<T = unknown>(sql: string, params: unknown[] = []) {
      const lower = sql.toLowerCase().trim();
      if (lower.startsWith('select storage_key from assets')) {
        record(sql, params);
        return { rows: [{ storage_key: 'u1/i1/photo.png' }, { storage_key: 'u1/i1/thumb.png' }] };
      }
      return runTransaction(sql, params);
    },
    async connect() {
      return {
        query: runTransaction,
        release() { /* no-op */ }
      };
    }
  } as any;
}

const baseRows: FakeRow[] = [
  {
    id: 'i1',
    type: 'link',
    title: 'Hello',
    source_url: 'https://example.com/hello',
    raw_text: null,
    ocr_text: null,
    status: 'ready',
    captured_at: '2026-09-18T09:00:00.000Z',
    created_at: '2026-09-18T09:00:00.000Z',
    updated_at: '2026-09-18T09:00:00.000Z',
    asset_storage_key: null
  },
  {
    id: 'i2',
    type: 'image',
    title: 'Pic',
    source_url: null,
    raw_text: null,
    ocr_text: null,
    status: 'pending',
    captured_at: '2026-09-18T10:00:00.000Z',
    created_at: '2026-09-18T10:00:00.000Z',
    updated_at: '2026-09-18T10:00:00.000Z',
    asset_storage_key: 'user-1/i2/photo.png'
  }
];
(baseRows as any).__owner = { i1: 'u1', i2: 'u1' };

describe('GET /api/v1/items', () => {
  function makeApp(developmentUserId: string) {
    const pool = createFakePool(baseRows, { i1: ['design', 'link'] });
    const repo = { async findById() { return null; } };
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createItemRouter({ pool, repository: repo as any, expectedToken: 't', developmentUserId }));
    return app;
  }

  it('returns the envelope shape the web + extension expect', async () => {
    const response = await request(makeApp('u1'))
      .get('/api/v1/items?limit=50')
      .set('Authorization', 'Bearer t');

    expect(response.status).toBe(200);
    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data.items)).toBe(true);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.limit).toBe(50);
    expect(['link', 'image']).toContain(response.body.data.items[0].kind);
    const linkRow = response.body.data.items.find((i: any) => i.id === 'i1');
    expect(linkRow.tags).toEqual(['design', 'link']);
  });

  it('rejects missing auth header with 401', async () => {
    const response = await request(makeApp('u1')).get('/api/v1/items');
    expect(response.status).toBe(401);
  });

  it('rejects an invalid bearer token', async () => {
    const response = await request(makeApp('u1')).get('/api/v1/items').set('Authorization', 'Bearer wrong');
    expect(response.status).toBe(401);
  });

  it('filters out rows owned by a different user (cross-tenant isolation)', async () => {
    const response = await request(makeApp('u2'))
      .get('/api/v1/items?limit=50')
      .set('Authorization', 'Bearer t');
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(0);
    expect(response.body.data.total).toBe(0);
  });

  it('exposes is_favorite on every row and honours ?favorite=true', async () => {
    const rows = baseRows.map((r) => ({ ...r }));
    (rows[0] as FakeRow).is_favorite = true;
    const pool = createFakePool(rows, { i1: ['design'] });
    const repo = { async findById() { return null; } };
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createItemRouter({ pool, repository: repo as any, expectedToken: 't', developmentUserId: 'u1' }));

    const all = await request(app).get('/api/v1/items?limit=50').set('Authorization', 'Bearer t');
    expect(all.status).toBe(200);
    expect(all.body.data.items.find((i: any) => i.id === 'i1').is_favorite).toBe(true);
    expect(all.body.data.items.find((i: any) => i.id === 'i2').is_favorite).toBe(false);

    const favs = await request(app).get('/api/v1/items?limit=50&favorite=true').set('Authorization', 'Bearer t');
    expect(favs.status).toBe(200);
    expect(favs.body.data.items.map((i: any) => i.id)).toEqual(['i1']);
    expect(favs.body.data.total).toBe(1);
  });
});

describe('PATCH /api/v1/items/:id (favorite)', () => {
  const repoItem: FakeRepoItem = {
    id: 'i1',
    userId: 'u1',
    status: 'ready',
    type: 'link',
    title: 'Hello',
    sourceUrl: null,
    rawText: null,
    ocrText: null,
    ocrEngine: null,
    ocrConfidence: null,
    capturedAt: new Date('2026-09-18T09:00:00.000Z')
  };

  function makeApp(rows: FakeRow[]) {
    const pool = createFakePool(rows);
    const repo = {
      async findById(id: string) {
        return id === repoItem.id ? { ...repoItem } : null;
      }
    };
    const app = express();
    app.use(express.json());
    app.use('/api/v1', createItemRouter({ pool, repository: repo as any, expectedToken: 't', developmentUserId: 'u1' }));
    return app;
  }

  it('flips is_favorite on the row when called by the owner', async () => {
    const rows = baseRows.map((r) => ({ ...r }));
    const app = makeApp(rows);

    const response = await request(app)
      .patch('/api/v1/items/i1')
      .set('Authorization', 'Bearer t')
      .send({ isFavorite: true });

    expect(response.status).toBe(200);
    expect(response.body.item.isFavorite).toBe(true);
    expect(rows.find((r) => r.id === 'i1')!.is_favorite).toBe(true);
  });

  it('clears is_favorite when called with false', async () => {
    const rows = baseRows.map((r) => ({ ...r }));
    (rows[0] as FakeRow).is_favorite = true;
    const app = makeApp(rows);

    const response = await request(app)
      .patch('/api/v1/items/i1')
      .set('Authorization', 'Bearer t')
      .send({ isFavorite: false });

    expect(response.status).toBe(200);
    expect(rows.find((r) => r.id === 'i1')!.is_favorite).toBe(false);
  });

  it('rejects a non-boolean isFavorite payload', async () => {
    const app = makeApp(baseRows.map((r) => ({ ...r })));
    const response = await request(app)
      .patch('/api/v1/items/i1')
      .set('Authorization', 'Bearer t')
      .send({ isFavorite: 'yes' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IS_FAVORITE');
  });

  it('returns 404 when the item does not exist', async () => {
    const app = makeApp(baseRows.map((r) => ({ ...r })));
    const response = await request(app)
      .patch('/api/v1/items/does-not-exist')
      .set('Authorization', 'Bearer t')
      .send({ isFavorite: true });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/v1/items/:id', () => {
  const owned: FakeRepoItem = {
    id: 'i1',
    userId: 'u1',
    status: 'ready',
    type: 'image',
    title: 'Hello',
    sourceUrl: null,
    rawText: null,
    ocrText: null,
    ocrEngine: null,
    ocrConfidence: null,
    capturedAt: new Date('2026-09-18T09:00:00.000Z')
  };

  function makeApp(
    pool: any,
    repoItem: FakeRepoItem | null = owned
  ) {
    const repo = {
      async findById() {
        return repoItem ? { ...repoItem } : null;
      }
    };
    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1',
      createItemRouter({ pool, repository: repo as any, expectedToken: 't', developmentUserId: 'u1' })
    );
    return app;
  }

  it('deletes the item and every child row in one transaction', async () => {
    const pool = createDeleteFakePool();
    const response = await request(makeApp(pool))
      .delete('/api/v1/items/i1')
      .set('Authorization', 'Bearer t');

    expect(response.status).toBe(204);

    const sql = pool.calls.map((c) => c.sql);
    // Transaction is opened and committed.
    expect(sql).toContain('begin');
    expect(sql).toContain('commit');
    expect(sql).not.toContain('rollback');

    // Every child table is cleaned so no orphan rows survive the item.
    expect(sql).toContain('delete from item_tags where item_id = $1');
    expect(sql).toContain('delete from item_embeddings where item_id = $1');
    expect(sql).toContain('delete from assets where item_id = $1');
    expect(sql).toContain('delete from jobs where item_id = $1');
    expect(sql).toContain('delete from items where id = $1');
  });

  it('removes the image objects from storage after the DB commit', async () => {
    const removed: string[] = [];
    const pool = createDeleteFakePool();
    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1',
      createItemRouter({
        pool,
        repository: { async findById() { return { ...owned }; } } as any,
        expectedToken: 't',
        developmentUserId: 'u1',
        imageStorage: {
          async upload() { /* unused */ },
          async remove(key: string) { removed.push(key); },
          async createSignedUrl() { return null; }
        } as any
      })
    );

    const response = await request(app)
      .delete('/api/v1/items/i1')
      .set('Authorization', 'Bearer t');

    expect(response.status).toBe(204);
    expect(removed).toEqual(['u1/i1/photo.png', 'u1/i1/thumb.png']);
  });

  it('rolls back and does not commit when a child delete fails', async () => {
    const pool = createDeleteFakePool({ failOn: 'delete from assets' });
    const response = await request(makeApp(pool))
      .delete('/api/v1/items/i1')
      .set('Authorization', 'Bearer t');

    expect(response.status).toBeGreaterThanOrEqual(400);
    const sql = pool.calls.map((c) => c.sql);
    expect(sql).toContain('rollback');
    expect(sql).not.toContain('commit');
    // The item row must survive a partial failure.
    expect(sql).not.toContain('delete from items where id = $1');
  });

  it('returns 404 when the item does not exist', async () => {
    const pool = createDeleteFakePool();
    const response = await request(makeApp(pool, null))
      .delete('/api/v1/items/nope')
      .set('Authorization', 'Bearer t');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ITEM_NOT_FOUND');
  });

  it('returns 403 when the caller does not own the item', async () => {
    const pool = createDeleteFakePool();
    const foreign: FakeRepoItem = { ...owned, userId: 'someone-else' };
    const response = await request(makeApp(pool, foreign))
      .delete('/api/v1/items/i1')
      .set('Authorization', 'Bearer t');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    // Nothing may be deleted on a rejected request.
    expect(pool.calls.some((c) => c.sql.startsWith('delete from items'))).toBe(false);
  });

  it('requires authentication', async () => {
    const pool = createDeleteFakePool();
    const response = await request(makeApp(pool)).delete('/api/v1/items/i1');
    expect(response.status).toBe(401);
  });
});
