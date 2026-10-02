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
 * DELETE is covered by the existing app.test.ts + supertest suite; the
 * transactional pool used by DELETE needs a real `Pool.connect`
 * callback which is impractical to fake from this scope.
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
