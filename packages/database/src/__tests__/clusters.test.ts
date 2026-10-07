/**
 * Cluster repository integration test.
 *
 * Seeds two users with three clusters' worth of items and one
 * unclustered item each, then asserts:
 *   - refresh returns the right cluster count and unclustered count
 *   - the same id is returned across two refreshes (determinism)
 *   - user A and user B never see each other's items
 *
 * The test relies on the same fake-pool pattern as the existing
 * spaces test, but seeds embeddings + edges by hand so the connected
 * components are guaranteed without running a real embedding model.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPool, createClusterRepository } from '@mnemonics/database';
import type { Pool } from 'pg';
import { DATABASE_URL } from './setup.js';

let pool: Pool;
let userId: string;
let otherUserId: string;
let itemA1: string;
let itemA2: string;
let itemA3: string;
let itemA4: string;
let itemA5: string; // unclustered
let itemB1: string;
let itemB2: string;
let itemB3: string;

async function createUser(email: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return String(res.rows[0].id);
}

async function createItem(
  owner: string,
  overrides: { title?: string; type?: string; status?: string } = {}
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO items (user_id, type, title, captured_at, status, client_request_id)
     VALUES ($1, $2, $3, NOW(), $4, gen_random_uuid())
     RETURNING id`,
    [owner, overrides.type ?? 'text', overrides.title ?? 'item', overrides.status ?? 'ready']
  );
  return String(res.rows[0].id);
}

async function addEdge(a: string, b: string, user: string, weight = 0.9): Promise<void> {
  await pool.query(
    `INSERT INTO item_edges (user_id, from_item_id, to_item_id, edge_type, weight, attributes)
     VALUES ($1, $2, $3, 'similar', $4, '{}'),
            ($1, $3, $2, 'similar', $4, '{}')
     ON CONFLICT DO NOTHING`,
    [user, a, b, weight]
  );
}

beforeEach(async () => {
  pool = createPool(DATABASE_URL);
  userId = await createUser(`cluster-a-${Date.now()}-${Math.random()}@test.local`);
  otherUserId = await createUser(`cluster-b-${Date.now()}-${Math.random()}@test.local`);

  // User A: 5 items. a1..a3 are fully connected; a4 only to a1.
  itemA1 = await createItem(userId, { title: 'DCF valuation' });
  itemA2 = await createItem(userId, { title: 'Comparable companies' });
  itemA3 = await createItem(userId, { title: 'EV/EBITDA' });
  itemA4 = await createItem(userId, { title: 'Hospital M&A' });
  itemA5 = await createItem(userId, { title: 'Solo coffee note' });

  await addEdge(itemA1, itemA2, userId);
  await addEdge(itemA2, itemA3, userId);
  await addEdge(itemA1, itemA3, userId);
  await addEdge(itemA1, itemA4, userId, 0.85);

  // User B: 3 items, all connected.
  itemB1 = await createItem(otherUserId, { title: 'PPO paper' });
  itemB2 = await createItem(otherUserId, { title: 'Safe RL note' });
  itemB3 = await createItem(otherUserId, { title: 'Barrier function' });
  await addEdge(itemB1, itemB2, otherUserId);
  await addEdge(itemB2, itemB3, otherUserId);
  await addEdge(itemB1, itemB3, otherUserId);
});

afterEach(async () => {
  await pool.query(`DELETE FROM items WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM items WHERE user_id = $1`, [otherUserId]);
  await pool.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  await pool.query(`DELETE FROM auth.users WHERE id = $1`, [otherUserId]);
  await pool.end();
});

describe('cluster repository', () => {
  it('finds the expected cluster and unclustered count', async () => {
    const repo = createClusterRepository();
    const result = await repo.refresh(userId, { pool });

    // 4 eligible items (status='ready'). a1..a4 form a connected
    // component of 4; a5 is unclustered. So 1 cluster, 1 unclustered.
    expect(result.clusterCount).toBe(1);
    expect(result.unclusteredCount).toBe(1);
    expect(result.eligibleItemCount).toBe(5);
    expect(result.clusters[0].itemCount).toBe(4);
    expect(result.clusters[0].previewItems.length).toBeGreaterThan(0);
  });

  it('is deterministic across two refreshes (same ids)', async () => {
    const repo = createClusterRepository();
    const first = await repo.refresh(userId, { pool });
    const second = await repo.refresh(userId, { pool });
    expect(first.clusters.map((c) => c.id)).toEqual(
      second.clusters.map((c) => c.id)
    );
  });

  it('isolates users', async () => {
    const repo = createClusterRepository();
    const resultA = await repo.refresh(userId, { pool });
    const resultB = await repo.refresh(otherUserId, { pool });

    expect(resultA.clusters[0].userId).toBe(userId);
    expect(resultB.clusters[0].userId).toBe(otherUserId);

    // User A's cluster must not contain B's items.
    const aIds = await repo.listItemIds(resultA.clusters[0].id, userId, pool);
    expect(aIds).not.toContain(itemB1);
    const bIds = await repo.listItemIds(resultB.clusters[0].id, otherUserId, pool);
    expect(bIds).not.toContain(itemA1);
  });

  it('returns no clusters for an empty user', async () => {
    const emptyUser = await createUser(`empty-${Date.now()}@test.local`);
    try {
      const repo = createClusterRepository();
      const result = await repo.refresh(emptyUser, { pool });
      expect(result.clusterCount).toBe(0);
      expect(result.unclusteredCount).toBe(0);
    } finally {
      await pool.query(`DELETE FROM auth.users WHERE id = $1`, [emptyUser]);
    }
  });

  it('builds a title from tags and titles', async () => {
    // Tag the connected items so the title-builder has signal.
    for (const id of [itemA1, itemA2, itemA3, itemA4]) {
      await pool.query(
        `INSERT INTO tags (user_id, name, normalized_name)
         VALUES ($1, 'valuation', 'valuation')
         ON CONFLICT DO NOTHING`,
        [userId]
      );
      const tagId = await pool.query<{ id: string }>(
        `SELECT id FROM tags WHERE user_id = $1 AND normalized_name = 'valuation'`,
        [userId]
      );
      await pool.query(
        `INSERT INTO item_tags (item_id, tag_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id, tagId.rows[0].id]
      );
    }

    const repo = createClusterRepository();
    const result = await repo.refresh(userId, { pool });
    expect(result.clusters[0].title).not.toBeNull();
    expect(result.clusters[0].title!.toLowerCase()).toContain('valuation');
  });
});
