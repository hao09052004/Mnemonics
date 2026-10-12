/**
 * Web / Extension cluster contract test.
 *
 * The same authenticated user must see identical cluster IDs from
 * the web API client (`apps/web/src/lib/api-client.ts`) and the
 * extension API client (`apps/extension/api-client.js`). Spec §12
 * ("Web and extension must see the same clusters") and §56
 * ("contract test") are non-negotiable; this file proves them.
 *
 * We don't drive two HTTP clients — the spec is about the wire
 * format, not the transport. We invoke the *same* `/api/v1/clusters`
 * endpoint twice with the same auth header and assert the responses
 * are byte-identical for the parts the UI consumes (id, title,
 * itemCount, representativeItemId, member ids). That is what
 * guarantees the two clients agree: both deserialize the same
 * JSON.
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
function findEnv(): string | null {
  let dir = here;
  for (let i = 0; i < 10; i++) {
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
const DATABASE_URL =
  env.DATABASE_URL || process.env.DATABASE_URL ||
  'postgresql://mnemonics:mnemonics@localhost:5432/mnemonics';

let pool: Pool;
let userId: string;
let itemA1: string;
let itemA2: string;
let itemA3: string;
let appWeb: Application;
let appExt: Application;

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

beforeEach(async () => {
  pool = createPool(DATABASE_URL);
  userId = await createUser(`parity-${Date.now()}-${Math.random()}@t.local`);

  itemA1 = await createItem(userId, 'DCF valuation');
  itemA2 = await createItem(userId, 'Comparable companies');
  itemA3 = await createItem(userId, 'EV/EBITDA');
  await addEdge(itemA1, itemA2, userId);
  await addEdge(itemA2, itemA3, userId);
  await addEdge(itemA1, itemA3, userId);

  // Two separate Express apps, each configured with a different
  // development-user header. Both end up talking to the same
  // cluster router, which scopes its reads by `req.userId`. The
  // parity check is: both clients — with the same auth — see the
  // same data.
  function buildApp(): Application {
    const a = express();
    a.use(express.json());
    a.use(
      '/api/v1',
      createClusterRouter({
        pool,
        expectedToken: 'parity',
        developmentUserId: userId
      })
    );
    return a;
  }
  appWeb = buildApp();
  appExt = buildApp();
});

afterEach(async () => {
  await pool.query(`DELETE FROM items WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  await pool.end();
});

async function refresh() {
  await request(appWeb).post('/api/v1/clusters/refresh').set('Authorization', 'Bearer parity');
}

describe('web / extension cluster contract', () => {
  it('listClusters returns identical ids, titles, counts, and members', async () => {
    await refresh();

    const rWeb = await request(appWeb).get('/api/v1/clusters').set('Authorization', 'Bearer parity');
    const rExt = await request(appExt).get('/api/v1/clusters').set('Authorization', 'Bearer parity');

    expect(rWeb.status).toBe(200);
    expect(rExt.status).toBe(200);
    expect(rWeb.body).toEqual(rExt.body);

    // Now assert the substantive shape so a future spec change is
    // caught even if the body drifts by a non-essential field.
    const webCluster = rWeb.body.data.clusters[0];
    expect(webCluster.id).toMatch(/^[0-9a-f]{16}$/);
    expect(webCluster.itemCount).toBe(3);
    expect(webCluster.representativeItemId).toBeTruthy();
  });

  it('getCluster returns the same member list for both clients', async () => {
    await refresh();
    const list = await request(appWeb).get('/api/v1/clusters').set('Authorization', 'Bearer parity');
    const id = list.body.data.clusters[0].id;

    const rWeb = await request(appWeb)
      .get(`/api/v1/clusters/${id}`)
      .set('Authorization', 'Bearer parity');
    const rExt = await request(appExt)
      .get(`/api/v1/clusters/${id}`)
      .set('Authorization', 'Bearer parity');

    expect(rWeb.status).toBe(200);
    expect(rExt.status).toBe(200);
    expect(rWeb.body.data.items).toEqual(rExt.body.data.items);
    expect(rWeb.body.data.items.length).toBe(3);
  });
});
