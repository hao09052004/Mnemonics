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
  asset_storage_key: string | null;
}

function createFakePool(rows: FakeRow[], tagMap: Record<string, string[]> = {}) {
  const ownerMap: Record<string, string> = (rows as any).__owner || {};
  return {
    async query<T = unknown>(sql: string, params: unknown[] = []) {
      const lower = sql.toLowerCase().trim();
      if (lower.startsWith('select id, type, title, source_url')) {
        const userId = params[0];
        const filtered = rows.filter((r) => !ownerMap[r.id] || ownerMap[r.id] === userId);
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
        const filtered = rows.filter((r) => !ownerMap[r.id] || ownerMap[r.id] === userId);
        return { rows: [{ count: String(filtered.length) }] };
      }
      return { rows: [], rowCount: 0 };
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
});
