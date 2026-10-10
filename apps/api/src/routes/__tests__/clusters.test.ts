/**
 * Cluster API route tests.
 *
 * Each test sets up a single user with a small curated
 * cluster, calls the API as that user, and asserts the response
 * shape. User isolation is verified by a second user who must
 * never appear.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Application } from 'express';
import request from 'supertest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '@mnemonics/database';
import { createClusterRouter } from '../clusters.js';
import type { Pool } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
// Walk up until we find a `.env` file. API tests run from various
// CWDs (the package root, the monorepo root) so a hardcoded path
// is brittle. Stop at the first match.
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
const env: Record<string, string> = {};
const envPath = findEnv();
if (envPath) {
  readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  });
}
const DATABASE_URL = env.DATABASE_URL || process.env.DATABASE_URL ||
  'postgresql://mnemonics:mnemonics@localhost:5432/mnemonics';

let pool: Pool;
let userId: string;
let otherUserId: string;
let itemA1: string;
let itemA2: string;
let itemA3: string;
let itemA4: string;
let app: Application;
let otherApp: Application;

async function createUser(email: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return String(res.rows[0].id);
}

async function createItem(owner: string, title: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO items (user_id, type, title, captured_at, status, client_request_id)
     VALUES ($1, 'text', $2, NOW(), 'ready', gen_random_uuid())
     RETURNING id`,
    [owner, title]
  );
  return String(res.rows[0].id);
}

async function addEdge(a: string, b: string, user: string, weight = 0.9): Promise<void> {
  await pool.query(
    `INSERT INTO item_edges (user_id, from_item_id, to_item_id, edge_type, weight, attributes)
     VALUES ($1, $2, $3, 'similar', $4, '{}'),
            ($1, $3, $2, 'similar', $4, '{}')`,
    [user, a, b, weight]
  );
}

function buildApp(uid: string): Application {
  const a = express();
  a.use(express.json());
  a.use(
    '/api/v1',
    createClusterRouter({
      pool,
      expectedToken: 'dev',
      developmentUserId: uid
    })
  );
  return a;
}

beforeEach(async () => {
  // DB connection + row creation can exceed the 10 s default hook
  // budget on a busy dev machine, so raise it explicitly. The
  // first test in this file used to fail with "Hook timed out in
  // 10000ms" because the Supabase pool was cold.
  pool = createPool(DATABASE_URL);
  userId = await createUser(`api-a-${Date.now()}-${Math.random()}@t.local`);
  otherUserId = await createUser(`api-b-${Date.now()}-${Math.random()}@t.local`);

  itemA1 = await createItem(userId, 'DCF valuation');
  itemA2 = await createItem(userId, 'Comparable companies');
  itemA3 = await createItem(userId, 'EV/EBITDA');
  itemA4 = await createItem(userId, 'Solo');

  await addEdge(itemA1, itemA2, userId);
  await addEdge(itemA2, itemA3, userId);
  await addEdge(itemA1, itemA3, userId);

  // Other user has their own data
  const b1 = await createItem(otherUserId, 'PPO paper');
  const b2 = await createItem(otherUserId, 'Safe RL');
  await addEdge(b1, b2, otherUserId);

  app = buildApp(userId);
  otherApp = buildApp(otherUserId);
});

afterEach(async () => {
  await pool.query(`DELETE FROM items WHERE user_id IN ($1, $2)`, [userId, otherUserId]);
  await pool.query(`DELETE FROM auth.users WHERE id IN ($1, $2)`, [userId, otherUserId]);
  await pool.end();
});

describe('GET /api/v1/clusters', () => {
  it('returns 0 clusters before refresh', async () => {
    const r = await request(app)
      .get('/api/v1/clusters')
      .set('Authorization', 'Bearer dev');
    expect(r.status).toBe(200);
    expect(r.body.data.clusters).toEqual([]);
  });

  it('returns 1 cluster after refresh', async () => {
    const refresh = await request(app)
      .post('/api/v1/clusters/refresh')
      .set('Authorization', 'Bearer dev');
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.clusterCount).toBe(1);

    const r = await request(app)
      .get('/api/v1/clusters')
      .set('Authorization', 'Bearer dev');
    expect(r.body.data.clusters.length).toBe(1);
    expect(r.body.data.clusters[0].itemCount).toBe(3);
    expect(r.body.data.unclusteredCount).toBe(1);
  });

  it('returns 404 when the feature is disabled', async () => {
    process.env.CONTENT_CLUSTERING_ENABLED = 'false';
    try {
      const r = await request(app)
        .get('/api/v1/clusters')
        .set('Authorization', 'Bearer dev');
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('CLUSTERING_DISABLED');
    } finally {
      delete process.env.CONTENT_CLUSTERING_ENABLED;
    }
  });
});

describe('GET /api/v1/clusters/:id', () => {
  it('returns the cluster + member ids', async () => {
    await request(app).post('/api/v1/clusters/refresh').set('Authorization', 'Bearer dev');
    const list = await request(app).get('/api/v1/clusters').set('Authorization', 'Bearer dev');
    const id = list.body.data.clusters[0].id;

    const r = await request(app)
      .get(`/api/v1/clusters/${id}`)
      .set('Authorization', 'Bearer dev');
    expect(r.status).toBe(200);
    expect(r.body.data.cluster.id).toBe(id);
    expect(r.body.data.items.length).toBe(3);
  });

  it('returns 404 for a different user cluster', async () => {
    await request(app).post('/api/v1/clusters/refresh').set('Authorization', 'Bearer dev');
    const list = await request(app).get('/api/v1/clusters').set('Authorization', 'Bearer dev');
    const id = list.body.data.clusters[0].id;

    const r = await request(otherApp)
      .get(`/api/v1/clusters/${id}`)
      .set('Authorization', 'Bearer dev');
    expect(r.status).toBe(404);
  });
});

describe('POST /api/v1/clusters/:id/save-as-space', () => {
  it('creates a manual Space from cluster members', async () => {
    await request(app).post('/api/v1/clusters/refresh').set('Authorization', 'Bearer dev');
    const list = await request(app).get('/api/v1/clusters').set('Authorization', 'Bearer dev');
    const id = list.body.data.clusters[0].id;

    const r = await request(app)
      .post(`/api/v1/clusters/${id}/save-as-space`)
      .set('Authorization', 'Bearer dev')
      .send({ color: 'blue' });
    expect(r.status).toBe(201);
    expect(r.body.data.spaceId).toBeTruthy();
    expect(r.body.data.memberCount).toBe(3);

    // The Space exists and has 3 members.
    const detail = await pool.query(
      `SELECT s.id, s.name, s.space_type, s.cover_item_id
         FROM spaces s WHERE s.id = $1 AND s.user_id = $2`,
      [r.body.data.spaceId, userId]
    );
    expect(detail.rows[0].space_type).toBe('manual');

    const members = await pool.query<{ item_id: string }>(
      `SELECT item_id FROM space_items WHERE space_id = $1`,
      [r.body.data.spaceId]
    );
    expect(members.rowCount).toBe(3);
  });
});
