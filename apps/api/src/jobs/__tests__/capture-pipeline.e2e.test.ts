import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { ItemRepository, NewImageItem, NewItem, StoredItem } from '@mnemonics/database';
import { createCaptureRouter } from '../../routes/capture.js';
import { createJobRouter } from '../router.js';
import type { ImageStorage } from '../../storage.js';

function createInMemoryPool() {
  const jobs = new Map<string, any>();

  const pool = {
    async query(sql: string, params: any[]) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('INSERT INTO jobs')) {
        const id = params[0];
        const row = {
          id,
          type: params[1],
          item_id: params[2],
          user_id: params[3],
          payload: JSON.parse(params[4] || '{}'),
          status: 'pending',
          attempts: 0,
          max_attempts: params[5] || 3,
          error: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null
        };
        jobs.set(id, row);
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('SELECT * FROM jobs') && normalized.includes("status = 'pending'")) {
        const pending = [...jobs.values()]
          .filter((job) => job.status === 'pending' && job.attempts < job.max_attempts)
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .slice(0, params[0]);
        return { rows: pending, rowCount: pending.length };
      }

      if (normalized.startsWith('UPDATE jobs SET status = \'processing\'')) {
        const row = jobs.get(params[0]);
        if (!row || row.status !== 'pending') return { rows: [], rowCount: 0 };
        row.status = 'processing';
        row.attempts += 1;
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('UPDATE jobs SET status = \'completed\'')) {
        const row = jobs.get(params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'completed';
        row.completed_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('UPDATE jobs SET status = \'failed\'')) {
        const row = jobs.get(params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'failed';
        row.error = params[1];
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('UPDATE jobs SET status = \'pending\'')) {
        const row = jobs.get(params[0]);
        if (!row || row.attempts >= row.max_attempts) return { rows: [], rowCount: 0 };
        row.status = 'pending';
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('SELECT COUNT(*) AS total')) {
        const itemId = params[0];
        const itemJobs = [...jobs.values()].filter((job) => job.item_id === itemId);
        const completed = itemJobs.filter((job) => job.status === 'completed').length;
        return {
          rows: [{ total: String(itemJobs.length), completed: String(completed) }],
          rowCount: 1
        };
      }

      if (normalized.startsWith('SELECT * FROM jobs WHERE id =')) {
        const row = jobs.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith('SELECT * FROM jobs WHERE item_id =')) {
        const rows = [...jobs.values()].filter((job) => job.item_id === params[0]);
        return { rows, rowCount: rows.length };
      }

      throw new Error('Unhandled fake pool query: ' + normalized);
    }
  };

  return { pool, jobs };
}

function createInMemoryRepository() {
  const items = new Map<string, StoredItem>();
  const byClientRequestId = new Map<string, string>();

  const repository: ItemRepository = {
    async findById(id) {
      return items.get(id) ?? null;
    },

    async findByClientRequestId(userId, clientRequestId) {
      const id = byClientRequestId.get(userId + ':' + clientRequestId);
      return id ? (items.get(id) ?? null) : null;
    },

    async createPendingItem({ userId, capture }: NewItem) {
      const id = crypto.randomUUID();
      const item = {
        id,
        userId,
        status: 'pending' as const,
        type: capture.type,
        title: capture.title,
        sourceUrl: capture.sourceUrl ?? null,
        rawText: capture.selectedText ?? null,
        ocrText: null,
        ocrEngine: null,
        ocrConfidence: null,
        capturedAt: capture.capturedAt
      };
      items.set(id, item);
      byClientRequestId.set(userId + ':' + capture.clientRequestId, id);
      return item;
    },

    async createPendingImageItem({ userId, capture, itemId }: NewImageItem) {
      if (capture.type !== 'image') throw new Error('Expected image capture');
      const item = {
        id: itemId,
        userId,
        status: 'pending' as const,
        type: 'image',
        title: capture.title,
        sourceUrl: capture.sourceUrl ?? null,
        rawText: capture.selectedText ?? null,
        ocrText: null,
        ocrEngine: null,
        ocrConfidence: null,
        capturedAt: capture.capturedAt
      };
      items.set(itemId, item);
      byClientRequestId.set(userId + ':' + capture.clientRequestId, itemId);
      return item;
    },

    async updateStatus(id, status) {
      const item = items.get(id);
      if (!item) throw new Error('Item not found');
      item.status = status;
    },

    async updateOcrText(id, ocrText, options) {
      const item = items.get(id);
      if (!item) throw new Error('Item not found');
      item.ocrText = ocrText;
      item.ocrEngine = options?.engine ?? null;
      item.ocrConfidence = options?.confidence ?? null;
    },

    async updateTags(id, _tags) {
      if (!items.has(id)) throw new Error('Item not found');
    },

    async saveEmbedding(id, _userId, _embedding, _model) {
      if (!items.has(id)) throw new Error('Item not found');
    }
  };

  return { repository, items };
}

function createFakeStorage(): ImageStorage {
  return {
    async upload() {},
    async remove() {}
  };
}

async function drainQueue(queue: { processOnce: () => Promise<void> }, steps: number) {
  for (let index = 0; index < steps; index += 1) {
    await queue.processOnce();
  }
}

describe('capture processing pipeline E2E', () => {
  it('processes text capture from pending to ready', async () => {
    const { pool } = createInMemoryPool();
    const { repository, items } = createInMemoryRepository();
    const { queue } = createJobRouter({ pool: pool as any, repository });

    const app = express();
    app.use(express.json());
    app.use('/api/v1', createCaptureRouter({
      repository,
      createJob: (type, itemId, userId) => queue.create({ type, itemId, userId }),
      expectedToken: 'mnemonics-dev-token'
    }));

    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .send({
        type: 'text',
        title: 'Pipeline text',
        selectedText: 'retrievable pipeline knowledge',
        capturedAt: '2026-09-25T08:00:00.000Z',
        clientRequestId: '88888888-8888-4888-8888-888888888888'
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('pending');

    await drainQueue(queue, 2);

    const item = items.get(response.body.data.id);
    expect(item?.status).toBe('ready');
    expect(item?.rawText).toContain('retrievable pipeline knowledge');

    queue.stop();
  });

  it('processes image capture through OCR -> tag -> embed -> ready', async () => {
    const { pool } = createInMemoryPool();
    const { repository, items } = createInMemoryRepository();
    const { queue } = createJobRouter({ pool: pool as any, repository });

    const app = express();
    app.use('/api/v1', createCaptureRouter({
      repository,
      imageStorage: createFakeStorage(),
      createJob: (type, itemId, userId) => queue.create({ type, itemId, userId }),
      expectedToken: 'mnemonics-dev-token'
    }));

    const response = await request(app)
      .post('/api/v1/captures/image')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .field('title', 'Pipeline screenshot')
      .field('clientRequestId', '99999999-9999-4999-8999-999999999999')
      .attach('file', Buffer.from('fake-image'), {
        filename: 'capture.png',
        contentType: 'image/png'
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('pending');

    await drainQueue(queue, 3);

    const item = items.get(response.body.data.id);
    expect(item?.status).toBe('ready');
    expect(item?.ocrEngine).toBe('none');
    expect(item?.ocrText).toBe('');

    queue.stop();
  });
});
