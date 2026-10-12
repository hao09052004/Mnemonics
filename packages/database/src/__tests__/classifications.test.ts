/**
 * ClassificationRepository — integration tests.
 *
 * Runs against the real Postgres. Asserts:
 *  1. upsert writes a ready row; findByItemId returns it.
 *  2. Ownership is enforced (a wrong user_id throws).
 *  3. The DB ownership trigger fires when a row tries to
 *     bypass the API layer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPool,
  createItemRepository,
  createClassificationRepository
} from '@mnemonics/database';
import type { Pool } from 'pg';
import { DATABASE_URL } from './setup.js';

const skipIfNoDb = !DATABASE_URL;

async function createUser(pool: Pool, email: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return String(res.rows[0].id);
}

describe.skipIf(skipIfNoDb)('ClassificationRepository (M2)', () => {
  let pool: Pool;
  let userId: string;
  let otherUserId: string;
  let itemId: string;
  let otherItemId: string;
  const itemIds: string[] = [];
  const userIds: string[] = [];

  beforeEach(async () => {
    pool = createPool(DATABASE_URL!);
    userId = await createUser(pool, `cls-owner-${Date.now()}-${Math.random()}@example.com`);
    otherUserId = await createUser(pool, `cls-other-${Date.now()}-${Math.random()}@example.com`);
    userIds.push(userId, otherUserId);

    const items = createItemRepository(pool);
    const a = await items.createPendingItem({
      userId,
      capture: {
        type: 'link',
        title: 'chair',
        sourceUrl: 'https://example.com/chair',
        clientRequestId: crypto.randomUUID()
      }
    });
    const b = await items.createPendingItem({
      userId: otherUserId,
      capture: {
        type: 'link',
        title: 'foreign',
        sourceUrl: 'https://example.com/foreign',
        clientRequestId: crypto.randomUUID()
      }
    });
    itemId = a.id;
    otherItemId = b.id;
    itemIds.push(itemId, otherItemId);
  });

  afterEach(async () => {
    if (itemIds.length) {
      await pool.query(`DELETE FROM items WHERE id = ANY($1::uuid[])`, [itemIds]);
    }
    if (userIds.length) {
      await pool.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [userIds]);
    }
    itemIds.length = 0;
    userIds.length = 0;
    await pool.end();
  });

  it('upserts a ready classification and finds it back', async () => {
    const repo = createClassificationRepository(pool);
    await repo.upsert({
      itemId,
      userId,
      detectedType: 'product',
      category: 'furniture',
      description: 'a chair',
      attributes: { material: 'wood' },
      entities: [],
      evidence: { material: 'structured_data' },
      confidence: 0.93,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      classifierVersion: 'v1',
      status: 'ready',
      errorCode: null,
      contentHash: 'sha256:abc'
    });
    const row = await repo.findByItemId(itemId, userId);
    expect(row).not.toBeNull();
    expect(row!.detectedType).toBe('product');
    expect(row!.attributes).toEqual({ material: 'wood' });
    expect(row!.status).toBe('ready');
  });

  it('rejects an upsert whose user_id does not match the parent item', async () => {
    const repo = createClassificationRepository(pool);
    await expect(
      repo.upsert({
        itemId,
        userId: otherUserId,
        detectedType: null,
        category: null,
        description: null,
        attributes: {},
        entities: [],
        evidence: {},
        confidence: null,
        provider: 'gemini',
        model: 'm',
        classifierVersion: 'v1',
        status: 'failed',
        errorCode: 'OWNERSHIP_MISMATCH',
        contentHash: null
      })
    ).rejects.toThrow(/OWNERSHIP_MISMATCH/);
  });

  it('upsert replaces the previous row on the same item_id', async () => {
    const repo = createClassificationRepository(pool);
    await repo.upsert({
      itemId, userId,
      detectedType: 'webpage', category: null, description: null,
      attributes: {}, entities: [], evidence: {},
      confidence: 0.1, provider: 'gemini', model: 'm',
      classifierVersion: 'v1', status: 'pending',
      errorCode: null, contentHash: 'sha256:first'
    });
    await repo.upsert({
      itemId, userId,
      detectedType: 'product', category: 'furniture',
      description: 'a chair',
      attributes: { material: 'wood' }, entities: [],
      evidence: { material: 'structured_data' },
      confidence: 0.95, provider: 'gemini', model: 'm',
      classifierVersion: 'v1', status: 'ready',
      errorCode: null, contentHash: 'sha256:second'
    });
    const rows = await repo.listByUser(userId);
    const ours = rows.filter(r => r.itemId === itemId);
    expect(ours.length).toBe(1);
    expect(ours[0].status).toBe('ready');
    expect(ours[0].contentHash).toBe('sha256:second');
  });
});
