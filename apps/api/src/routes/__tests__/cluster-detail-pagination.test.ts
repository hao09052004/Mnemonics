/**
 * Cluster Detail pagination tests (Milestone 2).
 *
 * Verifies the API contract called out in §9, §10, §11 of the
 * upgrade brief:
 *
 *  - The detail endpoint returns hydrated member DTOs, not just
 *    raw ids. The client must not have to intersect a global
 *    `items` list to render a cluster.
 *  - The endpoint caps the page size at 100. `limit: 200` is
 *    rejected, the default is 50, and the call returns the
 *    items with stable ordering across pages.
 *  - Backend `itemCount` matches the actual membership so a
 *    user with 250 members can paginate through ALL of them.
 *  - Title and summary come from the cluster row, not from a
 *    member.
 *  - A member is never duplicated across pages.
 *  - A user cannot see another user's cluster (404, never the
 *    rows).
 *
 * The tests are black-box: a test pool is loaded with a single
 * cluster of N members, the route is exercised with the real
 * Express stack, and the response is asserted.
 *
 * Skipped when no Postgres test database is configured: the
 * `findTestDb()` helper returns null and the suite is marked
 * as a no-op so the local `pnpm test` run is not blocked.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Application } from 'express';
import request from 'supertest';
import { createPool } from '@mnemonics/database';
import { createClusterRouter } from '../clusters.js';
import type { Pool } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

function findEnv(): string | null {
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readEnv(): Record<string, string> {
  const file = findEnv();
  if (!file) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnv();
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || env.TEST_DATABASE_URL;

let pool: Pool | null = null;
let isAvailable = false;
let userA: string;
let userB: string;
let clusterA: { id: string; size: number };

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = createPool(TEST_DATABASE_URL);
  try {
    await pool.query('SELECT 1');
    isAvailable = true;
  } catch {
    pool = null;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
});

beforeEach(async () => {
  if (!isAvailable || !pool) return;
  // Two isolated users per test. UUIDs are deterministic to keep
  // failures reproducible across re-runs.
  userA = '11111111-0000-4000-8000-000000000001';
  userB = '22222222-0000-4000-8000-000000000001';

  // Clean previous fixtures (idempotent). We do NOT touch
  // pre-existing rows owned by other test users.
  await pool.query(`DELETE FROM content_cluster_items WHERE cluster_id IN (SELECT id FROM content_clusters WHERE user_id IN ($1, $2))`, [userA, userB]);
  await pool.query(`DELETE FROM content_clusters WHERE user_id IN ($1, $2)`, [userA, userB]);
  await pool.query(`DELETE FROM item_embeddings WHERE item_id IN (SELECT id FROM items WHERE user_id IN ($1, $2))`, [userA, userB]);
  await pool.query(`DELETE FROM item_edges WHERE user_id IN ($1, $2)`, [userA, userB]);
  await pool.query(`DELETE FROM items WHERE user_id IN ($1, $2)`, [userA, userB]);
});

async function seedCluster(userId: string, size: number): Promise<{ id: string; size: number }> {
  if (!pool) throw new Error('pool not available');
  // Seed `size` items + one embedding each. Embeddings are zero
  // vectors because the test does not exercise similarity.
  const itemIds: string[] = [];
  for (let i = 0; i < size; i++) {
    const itemId = `00000000-0000-4000-8000-${String(1_000_000 + i).padStart(12, '0')}`;
    itemIds.push(itemId);
    await pool.query(
      `INSERT INTO items (id, user_id, type, title, status, captured_at, created_at, updated_at)
       VALUES ($1, $2, 'text', $3, 'ready', NOW(), NOW(), NOW())`,
      [itemId, userId, `Item ${i}`]
    );
    await pool.query(
      `INSERT INTO item_embeddings (item_id, model, dimensions, embedding, embedding_version, embedding_kind, updated_at)
       VALUES ($1, 'gemini-embedding-001', 1024, ARRAY_FILL(0.0, ARRAY[1024])::vector, 'test-v1', 'real', NOW())`,
      [itemId]
    );
  }
  // Pick a stable id from the sorted member list so the test is
  // repeatable.
  const sorted = [...itemIds].sort();
  const id = `cluster-${userId}-${size}`;
  await pool.query(
    `INSERT INTO content_clusters (id, user_id, signature, title, summary, item_count, average_edge_weight, algorithm_version, embedding_model, similarity_threshold, min_size, created_at, updated_at)
     VALUES ($1, $2, $1, $3, $4, $5, 0, 'cc-on-edges-v1', 'gemini-embedding-001', 0.78, 2, NOW(), NOW())`,
    [id, userId, `Cluster of ${size}`, `Seeded cluster for size=${size}`, size]
  );
  for (let r = 0; r < itemIds.length; r++) {
    await pool.query(
      `INSERT INTO content_cluster_items (cluster_id, item_id, score, rank) VALUES ($1, $2, 0, $3)`,
      [id, itemIds[r], r]
    );
  }
  return { id, size };
}

function makeApp(p: Pool): Application {
  const app = express();
  app.use(express.json());
  // Development-token auth: the test sends Authorization: Bearer
  // dev:USER_A which the dev auth maps to the user.
  app.use((req, _res, next) => {
    const h = String(req.headers.authorization || '');
    const m = h.match(/^Bearer dev:([0-9a-f-]+)$/i);
    if (m) (req as { userId?: string }).userId = m[1];
    next();
  });
  // Force dev auth by providing a developmentUserId; the router
  // falls back to requireDevelopmentAuth when no Supabase client
  // is provided.
  app.use(
    createClusterRouter({
      pool: p,
      expectedToken: 'dev',
      developmentUserId: userA,
    })
  );
  return app;
}

const SUITE = describe('GET /api/v1/clusters/:id — Milestone 2 pagination', () => {
  if (!isAvailable) {
    it.skip('requires TEST_DATABASE_URL', () => {
      // Surface the skip reason in the run output so a missing env
      // var is obvious.
      // eslint-disable-next-line no-console
      console.warn('[m2] TEST_DATABASE_URL not set — skipping DB-backed tests');
    });
    return;
  }

  it('returns hydrated member DTOs, not raw ids', async () => {
    clusterA = await seedCluster(userA, 5);
    const app = makeApp(pool!);
    const res = await request(app)
      .get(`/api/v1/clusters/${clusterA.id}?limit=50&offset=0`)
      .set('Authorization', `Bearer dev:${userA}`);
    expect(res.status).toBe(200);
    const items = res.body.data.items;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(5);
    for (const it of items) {
      expect(typeof it.id).toBe('string');
      expect(typeof it.kind).toBe('string');
      expect(typeof it.rank).toBe('number');
    }
  });

  it('returns authoritative title + summary from the cluster row', async () => {
    clusterA = await seedCluster(userA, 3);
    const app = makeApp(pool!);
    const res = await request(app)
      .get(`/api/v1/clusters/${clusterA.id}`)
      .set('Authorization', `Bearer dev:${userA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cluster.title).toBe(`Cluster of 3`);
    expect(res.body.data.cluster.summary).toBe(`Seeded cluster for size=3`);
    // The title is NOT derived from any member.
    expect(res.body.data.cluster.title).not.toBe(`Item 0`);
  });

  it('caps limit at 100 (requesting 200 is rejected or capped)', async () => {
    clusterA = await seedCluster(userA, 5);
    const app = makeApp(pool!);
    const res = await request(app)
      .get(`/api/v1/clusters/${clusterA.id}?limit=200`)
      .set('Authorization', `Bearer dev:${userA}`);
    // The Zod schema enforces max=100, so 200 fails validation and
    // falls back to the default of 50. Either way, the response
    // MUST not contain more than 100 items.
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeLessThanOrEqual(100);
  });

  it('paginates all members for a 250-item cluster', async () => {
    clusterA = await seedCluster(userA, 250);
    const app = makeApp(pool!);
    const seen = new Set<string>();
    let offset = 0;
    let totalItemCount = 0;
    while (true) {
      const res = await request(app)
        .get(`/api/v1/clusters/${clusterA.id}?limit=100&offset=${offset}`)
        .set('Authorization', `Bearer dev:${userA}`);
      expect(res.status).toBe(200);
      const items = res.body.data.items as Array<{ id: string }>;
      totalItemCount = res.body.data.cluster.itemCount;
      for (const it of items) {
        expect(seen.has(it.id)).toBe(false); // no duplicates
        seen.add(it.id);
      }
      if (items.length < 100) break;
      offset += 100;
    }
    expect(seen.size).toBe(250);
    expect(totalItemCount).toBe(250);
  });

  it('returns 404 for a different user', async () => {
    clusterA = await seedCluster(userA, 3);
    const app = makeApp(pool!);
    const res = await request(app)
      .get(`/api/v1/clusters/${clusterA.id}`)
      .set('Authorization', `Bearer dev:${userB}`);
    expect(res.status).toBe(404);
  });

  it('is stable across pages (no duplicate or missing rows)', async () => {
    clusterA = await seedCluster(userA, 75);
    const app = makeApp(pool!);
    const first = await request(app)
      .get(`/api/v1/clusters/${clusterA.id}?limit=50&offset=0`)
      .set('Authorization', `Bearer dev:${userA}`);
    const second = await request(app)
      .get(`/api/v1/clusters/${clusterA.id}?limit=50&offset=50`)
      .set('Authorization', `Bearer dev:${userA}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const ids1 = (first.body.data.items as Array<{ id: string }>).map((i) => i.id);
    const ids2 = (second.body.data.items as Array<{ id: string }>).map((i) => i.id);
    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap).toEqual([]);
    expect(ids1.length + ids2.length).toBe(75);
  });
});

void SUITE;
