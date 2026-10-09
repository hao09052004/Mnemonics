/**
 * M8 — embed handler reads targetEmbeddingModel from the
 * payload.
 *
 * The contract: a job with `targetEmbeddingModel: 'foo'`
 * in the payload writes a row whose `embedding_model`
 * column is `'foo'`, regardless of the env var. A job
 * without the field uses the env-driven model (M1
 * contract preserved).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedHandler } from '../handlers/embed.js';

function createAi() {
  return {
    text: { info: () => ({ name: 'noop', model: 'noop' }), generateTags: async () => [], summarize: async () => '' },
    embeddings: {
      info: () => ({ name: 'gemini', model: 'gemini-embedding-001', dimensions: 1024 }),
      embedOne: async () => [0.1, 0.2, 0.3],
      embedMany: async () => [[0.1, 0.2, 0.3]]
    },
    primaryOcr: { info: () => ({ name: 'noop', model: 'noop' }) },
    fallbackOcr: { info: () => ({ name: 'noop', model: 'noop' }) },
    visual: { info: () => ({ name: 'noop', model: 'noop' }) },
    recognizeWithFallback: async () => ({ text: '', engine: 'noop', confidence: 0 }),
    tagCache: { get: () => undefined, set: () => undefined },
    summaryCache: { get: () => undefined, set: () => undefined },
    embeddingCache: { get: () => undefined, set: () => undefined },
    ocrCache: { get: () => undefined, set: () => undefined },
    health: async () => ({
      config: { freeOnly: true, demoMode: true, text: 'noop', embeddings: 'gemini', ocr: 'noop', visual: 'noop' },
      textReady: false, embeddingsReady: true, ocrReady: false, visualReady: false, notes: []
    }),
    config: {} as any
  } as any;
}

const USER_ID = '00000000-0000-4000-8000-000000000001';
const ITEM_ID = '00000000-0000-4000-8000-000000000010';

function createPoolStub() {
  const written: Array<{ sql: string; params: unknown[] }> = [];
  return {
    written,
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes('INSERT INTO item_embeddings')) {
        written.push({ sql, params });
      }
      if (sql.includes('FROM item_enrichments')) {
        return { rows: [{ caption: null, tldr: null }], rowCount: 1 };
      }
      if (sql.includes('FROM items') && !sql.includes('item_embeddings')) {
        return {
          rows: [{
            id: ITEM_ID,
            user_id: USER_ID,
            type: 'text',
            title: 'Hello',
            raw_text: 'World',
            ocr_text: null,
            captured_at: new Date().toISOString(),
            status: 'ready'
          }],
          rowCount: 1
        };
      }
      if (sql.includes('UPDATE items')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

function createRepositoryStub() {
  return {
    findById: async () => ({
      id: ITEM_ID,
      userId: USER_ID,
      type: 'text',
      title: 'Hello',
      rawText: 'World',
      ocrText: null,
      capturedAt: new Date(),
      status: 'ready'
    }),
    saveEmbedding: async () => undefined,
    updateStatus: async () => undefined
  } as any;
}

function createQueueStub() {
  return {
    markCompleted: vi.fn(async () => undefined),
    areAllJobsCompleted: vi.fn(async () => true),
    enqueue: vi.fn(async () => undefined)
  } as any;
}

describe('EmbedHandler — M8 targetEmbeddingModel payload', () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedEnv;
  });

  it('with no targetEmbeddingModel, the row uses the env-driven model', async () => {
    const captured: any[] = [];
    const repo = {
      findById: async () => ({
        id: ITEM_ID,
        userId: USER_ID,
        type: 'text',
        title: 'Hello',
        rawText: 'World',
        ocrText: null,
        capturedAt: new Date(),
        status: 'ready'
      }),
      saveEmbedding: async (...args: unknown[]) => {
        captured.push({ type: 'saveEmbedding', args });
      },
      updateStatus: async () => undefined
    } as any;
    const handler = new EmbedHandler({
      queue: createQueueStub(),
      repository: repo,
      ai: createAi(),
      pool: undefined
    });
    await handler.handle({
      id: 'job-1',
      itemId: ITEM_ID,
      userId: USER_ID,
      payload: {}
    });
    const save = captured.find((c) => c.type === 'saveEmbedding');
    expect(save, 'saveEmbedding must be called even with the default path').toBeDefined();
    // saveEmbedding(itemId, userId, embedding, model, options)
    expect(save!.args[3]).toBe('gemini-embedding-001');
  });

  it('with targetEmbeddingModel in the payload, the handler picks it up', async () => {
    const captured: any[] = [];
    const repo = {
      findById: async () => ({
        id: ITEM_ID,
        userId: USER_ID,
        type: 'text',
        title: 'Hello',
        rawText: 'World',
        ocrText: null,
        capturedAt: new Date(),
        status: 'ready'
      }),
      saveEmbedding: async (...args: unknown[]) => {
        captured.push({ type: 'saveEmbedding', args });
      },
      updateStatus: async () => undefined
    } as any;
    const handler = new EmbedHandler({
      queue: createQueueStub(),
      repository: repo,
      ai: createAi(),
      pool: undefined
    });
    await handler.handle({
      id: 'job-1',
      itemId: ITEM_ID,
      userId: USER_ID,
      payload: { targetEmbeddingModel: 'gemini-embedding-002' }
    });
    const save = captured.find((c) => c.type === 'saveEmbedding');
    expect(save, 'saveEmbedding must be called').toBeDefined();
    // saveEmbedding(itemId, userId, embedding, model, options)
    // args[0]=itemId, args[1]=userId, args[2]=embedding, args[3]=model
    expect(save!.args[3]).toBe('gemini-embedding-002');
  });

  it('with targetEmbeddingModel empty string, falls back to env model', async () => {
    const captured: any[] = [];
    const repo = {
      findById: async () => ({
        id: ITEM_ID,
        userId: USER_ID,
        type: 'text',
        title: 'Hello',
        rawText: 'World',
        ocrText: null,
        capturedAt: new Date(),
        status: 'ready'
      }),
      saveEmbedding: async (...args: unknown[]) => {
        captured.push({ type: 'saveEmbedding', args });
      },
      updateStatus: async () => undefined
    } as any;
    const handler = new EmbedHandler({
      queue: createQueueStub(),
      repository: repo,
      ai: createAi(),
      pool: undefined
    });
    await handler.handle({
      id: 'job-1',
      itemId: ITEM_ID,
      userId: USER_ID,
      payload: { targetEmbeddingModel: '' }
    });
    const save = captured.find((c) => c.type === 'saveEmbedding');
    expect(save).toBeDefined();
    expect(save!.args[3]).toBe('gemini-embedding-001');
  });
});
