import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPool, createEnrichmentRepository } from '@mnemonics/database';
import type { Pool } from 'pg';
import { DATABASE_URL } from './setup.js';

let pool: Pool;
let userId: string;
let itemId: string;
let enrichments: ReturnType<typeof createEnrichmentRepository>;

beforeEach(async () => {
  pool = createPool(DATABASE_URL);
  enrichments = createEnrichmentRepository(pool);
  const userRes = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, '', NOW(), 'authenticated', 'authenticated', NOW(), NOW())
     RETURNING id`,
    [`enr-test-${Date.now()}@example.com`]
  );
  userId = userRes.rows[0].id;
  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO items (user_id, type, title, captured_at, client_request_id)
     VALUES ($1, 'image', 'Test image', NOW(), gen_random_uuid()) RETURNING id`,
    [userId]
  );
  itemId = String(itemRes.rows[0].id);
});

afterEach(async () => {
  await pool.query(`DELETE FROM items WHERE user_id = $1::uuid`, [userId]);
  await pool.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [userId]);
  await pool.end();
});

describe('EnrichmentRepository', () => {
  it('ensureRow is idempotent', async () => {
    await enrichments.ensureRow(itemId, userId);
    await enrichments.ensureRow(itemId, userId);
    const row = await enrichments.getForItem(itemId);
    expect(row).not.toBeNull();
    expect(row!.itemId).toBe(itemId);
  });

  it('setCaption writes caption + status', async () => {
    await enrichments.ensureRow(itemId, userId);
    await enrichments.setCaption(itemId, userId, {
      caption: 'Three cartoon dragons',
      provider: 'local',
      model: 'Xenova/vit-gpt2-image-captioning',
      confidence: 0.7
    });
    const row = await enrichments.getForItem(itemId);
    expect(row!.caption).toBe('Three cartoon dragons');
    expect(row!.captionStatus).toBe('ready');
    expect(row!.captionProvider).toBe('local');
  });

  it('setUserTldr is preserved across auto-overwrites', async () => {
    await enrichments.ensureRow(itemId, userId);
    await enrichments.setTldr(itemId, userId, {
      tldr: 'AI tldr',
      source: 'local_ai',
      provider: 'deterministic',
      model: 'heuristic-v1',
      promptVersion: 'v1'
    });
    await enrichments.setUserTldr(itemId, userId, 'Bản chỉnh tay');
    const row = await enrichments.getForItem(itemId);
    expect(row!.tldr).toBe('Bản chỉnh tay');
    expect(row!.tldrSource).toBe('user');
  });

  it('lists texts for embedding with all enrichment fields', async () => {
    await enrichments.ensureRow(itemId, userId);
    await enrichments.setCaption(itemId, userId, {
      caption: 'cap', provider: 'local', model: 'm'
    });
    await enrichments.setTldr(itemId, userId, {
      tldr: 'tldr', source: 'local_ai', provider: 'deterministic', model: 'm', promptVersion: 'v1'
    });
    const rows = await enrichments.listTextForEmbedding(userId, [itemId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].caption).toBe('cap');
    expect(rows[0].tldr).toBe('tldr');
  });
});