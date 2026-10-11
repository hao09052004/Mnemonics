/**
 * Structured leg + RRF integration tests (spec 0005 §7.2).
 *
 * Run against the real Postgres. Asserts:
 *  1. An empty `structured` filter set does not change the
 *     response (the leg is empty and existing hits win).
 *  2. `detectedType` filter matches items whose
 *     classification has the same `detected_type`.
 *  3. `brand` AND `material` filters require BOTH attributes
 *     to be present (AND semantics across keys).
 *  4. The leg's contribution is visible in the response's
 *     `explain.structResults` and `weights.struct`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPool,
  createItemRepository,
  createClassificationRepository,
  runSearch,
  STRUCT_WEIGHT
} from '@mnemonics/database';
import type { Pool } from 'pg';
import { DATABASE_URL } from './setup.js';

const skipIfNoDb = !DATABASE_URL;

interface SeededItem {
  id: string;
  userId: string;
  title: string;
}

async function createUser(pool: Pool, email: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return String(r.rows[0].id);
}

async function seedItemWithClassification(
  pool: Pool,
  userId: string,
  title: string,
  body: string,
  classification: {
    detectedType: string;
    category?: string;
    attributes?: Record<string, unknown>;
  }
): Promise<SeededItem> {
  const items = createItemRepository(pool);
  const classifications = createClassificationRepository(pool);
  const created = await items.createPendingItem({
    userId,
    capture: {
      type: 'link',
      title,
      sourceUrl: `https://example.com/${encodeURIComponent(title)}`,
      clientRequestId: crypto.randomUUID()
    }
  });
  // Mark item ready so search picks it up.
  await pool.query(`UPDATE items SET status = 'ready', raw_text = $1 WHERE id = $2`,
    [body, created.id]);
  await classifications.upsert({
    itemId: created.id,
    userId,
    detectedType: classification.detectedType,
    category: classification.category ?? null,
    description: null,
    attributes: classification.attributes ?? {},
    entities: [],
    evidence: {},
    confidence: 0.9,
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    classifierVersion: 'v1',
    status: 'ready',
    errorCode: null,
    contentHash: `sha:test:${title}`
  });
  return { id: created.id, userId, title };
}

describe.skipIf(skipIfNoDb)('Structured search leg (M3)', () => {
  let pool: Pool;
  let userId: string;
  let recipeId: string;
  let chairId: string;
  const userIds: string[] = [];
  const itemIds: string[] = [];

  beforeEach(async () => {
    pool = createPool(DATABASE_URL!);
    userId = await createUser(pool, `search-struct-${Date.now()}-${Math.random()}@example.com`);
    userIds.push(userId);

    const a = await seedItemWithClassification(
      pool, userId, 'Spicy ramen',
      'A traditional Japanese ramen recipe with miso broth.',
      { detectedType: 'recipe', category: 'food', attributes: { cuisine: 'japanese' } }
    );
    const b = await seedItemWithClassification(
      pool, userId, 'IKEA chair',
      'A solid pine chair from the IKEA Markus series.',
      { detectedType: 'product', category: 'furniture', attributes: { brand: 'ikea', material: 'wood' } }
    );
    recipeId = a.id;
    chairId = b.id;
    itemIds.push(recipeId, chairId);
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

  it('empty structured filters do not change the response shape', async () => {
    const r = await runSearch({ pool }, userId, {
      q: '',
      filters: {}
    });
    expect(r.hits.length).toBe(2);
    expect(r.explain?.structResults).toBe(0);
    expect(r.explain?.weights.struct).toBe(STRUCT_WEIGHT);
    expect(STRUCT_WEIGHT).toBe(0.5);
  });

  it('detectedType filter matches the right item', async () => {
    const r = await runSearch({ pool }, userId, {
      q: '',
      filters: { structured: { detectedType: ['recipe'] } }
    });
    // The structured leg must produce exactly the recipe.
    expect(r.explain?.structResults).toBe(1);
    // And the recipe must be present in the fused hits.
    const ids = r.hits.map(h => h.id);
    expect(ids).toContain(recipeId);
  });

  it('brand AND material require both attributes', async () => {
    // Add a second product that has the brand but not the material.
    const c = await seedItemWithClassification(
      pool, userId, 'IKEA plastic',
      'Plastic storage box.',
      { detectedType: 'product', category: 'storage',
        attributes: { brand: 'ikea', material: 'plastic' } }
    );
    itemIds.push(c.id);

    const r = await runSearch({ pool }, userId, {
      q: '',
      filters: { structured: { brand: ['ikea'], material: ['wood'] } }
    });
    // The structured leg must produce only the chair (brand+wood).
    expect(r.explain?.structResults).toBe(1);
    expect(r.hits.map(h => h.id)).toContain(chairId);
    // The other ikea plastic product is NOT in the structured hits.
    // It still appears in lexical (recency) but with a lower
    // combined score than the chair.
  });

  it('multiple type hints are OR-ed', async () => {
    const r = await runSearch({ pool }, userId, {
      q: '',
      filters: { structured: { detectedType: ['recipe', 'product'] } }
    });
    // The structured leg must produce both.
    expect(r.explain?.structResults).toBe(2);
  });
});
