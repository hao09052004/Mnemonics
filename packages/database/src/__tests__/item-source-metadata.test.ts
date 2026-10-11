/**
 * M1 — items.source_metadata persistence.
 *
 * The new column stores parsed page metadata (JSON-LD, Open Graph,
 * Readability) so the M2 classifier and the M3 structured search
 * filters can read it in O(1) instead of re-fetching the source.
 *
 * The first test asserts the column exists and accepts a JSONB blob.
 * The second asserts backwards compatibility: rows created without
 * the field stay NULL.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPool,
  createItemRepository
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

describe.skipIf(skipIfNoDb)('ItemRepository — source_metadata (M1)', () => {
  let pool: Pool;
  let userId: string;
  let itemIds: string[] = [];

  beforeEach(async () => {
    pool = createPool(DATABASE_URL!);
    userId = await createUser(pool, `smeta-${Date.now()}-${Math.random()}@example.com`);
  });

  afterEach(async () => {
    if (itemIds.length > 0) {
      await pool.query(`DELETE FROM items WHERE id = ANY($1::uuid[])`, [itemIds]);
      itemIds = [];
    }
    await pool.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [userId]);
    await pool.end();
  });

  it('persists source_metadata on a link capture', async () => {
    const repo = createItemRepository(pool);
    const sourceMetadata = {
      ogTitle: 'Wooden Chair — A timeless piece',
      ogDescription: 'A chair made of wood',
      ogImage: 'https://example.com/chair.jpg',
      canonicalUrl: 'https://example.com/chair',
      jsonLd: [{ '@type': 'Product', name: 'Wooden Chair', material: 'Wood' }],
      article: null,
      contentHash: 'sha256:abcd1234'
    };
    const item = await repo.createPendingItem({
      userId,
      capture: {
        type: 'link',
        title: 'Wooden Chair',
        sourceUrl: 'https://example.com/chair',
        clientRequestId: crypto.randomUUID()
      },
      sourceMetadata
    });
    itemIds.push(item.id);

    const res = await pool.query<{ source_metadata: unknown }>(
      `SELECT source_metadata FROM items WHERE id = $1`,
      [item.id]
    );
    expect(res.rows[0].source_metadata).toEqual(sourceMetadata);
  });

  it('leaves source_metadata NULL when not provided', async () => {
    const repo = createItemRepository(pool);
    const item = await repo.createPendingItem({
      userId,
      capture: {
        type: 'link',
        title: 'no metadata',
        sourceUrl: 'https://example.com/x',
        clientRequestId: crypto.randomUUID()
      }
    });
    itemIds.push(item.id);

    const res = await pool.query<{ source_metadata: unknown }>(
      `SELECT source_metadata FROM items WHERE id = $1`,
      [item.id]
    );
    expect(res.rows[0].source_metadata).toBeNull();
  });

  it('persists source_metadata on an image capture', async () => {
    const repo = createItemRepository(pool);
    const sourceMetadata = {
      ogTitle: 'Captured image',
      jsonLd: [],
      article: null,
      contentHash: 'sha256:img01'
    };
    const item = await repo.createPendingImageItem({
      userId,
      itemId: crypto.randomUUID(),
      capture: {
        type: 'image',
        title: 'A picture',
        sourceUrl: 'https://example.com/p',
        image: { storageKey: 'k', mimeType: 'image/jpeg', sizeBytes: 1 },
        clientRequestId: crypto.randomUUID()
      },
      sourceMetadata
    });
    itemIds.push(item.id);

    const res = await pool.query<{ source_metadata: unknown }>(
      `SELECT source_metadata FROM items WHERE id = $1`,
      [item.id]
    );
    expect(res.rows[0].source_metadata).toEqual(sourceMetadata);
  });
});
