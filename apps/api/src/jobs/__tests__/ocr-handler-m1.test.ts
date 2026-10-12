/**
 * M1 Real OCR Tests
 *
 * Covers the production path of the OcrHandler:
 *   - Successful OCR.Space call writes ocrText + engine + language.
 *   - Asset not found is recorded as ocrErrorCode='NO_ASSET' but the
 *     job still completes and the tag job is enqueued.
 *   - Tesseract fallback runs when OCR.Space fails.
 *   - Quota counter is bumped on a successful OCR.Space call and
 *     not on a Tesseract call.
 *   - Quota exhaustion aborts the job and writes
 *     ocrErrorCode='OCR_QUOTA_EXHAUSTED'.
 */

import { describe, it, expect } from 'vitest';
import { OcrHandler, makeOcrStorageKeyResolver } from '../handlers/ocr.js';
import type { ItemRepository, StoredItem } from '@mnemonics/database';
import type { ImageStorage } from '../../storage.js';
import type { AiService, OcrResult } from '@mnemonics/ai';

const ITEM_ID = 'item-1';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const STORAGE_KEY = `${USER_ID}/${ITEM_ID}/capture.jpg`;

type Pool = {
  query: (
    sql: string,
    params: unknown[]
  ) => Promise<{ rows: Array<{ storage_key: string }> }>;
};

type QueueTracker = {
  completed: number;
  tagEnqueued: boolean;
  jobsCreated: any[];
};

function createAi(overrides: {
  primaryResult: OcrResult;
  fallbackResult?: OcrResult;
  primaryName?: string;
  fallbackName?: string;
}): AiService {
  const primary = {
    async recognize() {
      return overrides.primaryResult;
    },
    info() {
      return { name: overrides.primaryName ?? 'ocrspace', model: 'ocrspace-engine-2' };
    }
  };
  const fallback = overrides.fallbackResult
    ? {
        async recognize() {
          return overrides.fallbackResult!;
        },
        info() {
          return { name: overrides.fallbackName ?? 'tesseract', model: 'tesseract-5' };
        }
      }
    : primary;
  return {
    config: {
      freeOnly: true,
      demoMode: true,
      text: { provider: 'heuristic', geminiApiKey: undefined, geminiModel: 'deterministic-keyword-v1' },
      embeddings: {
        provider: 'noop',
        geminiApiKey: undefined,
        geminiModel: 'gemini-embedding-001',
        geminiDimensions: 1024,
        ollamaBaseUrl: undefined,
        ollamaEmbeddingModel: 'bge-m3',
        embeddingsFallback: true
      },
      ocr: {
        provider: 'ocrspace',
        ocrSpaceApiKey: undefined,
        ocrSpaceDailySoftLimit: 450,
        localFallback: true
      },
      vision: { provider: 'local', clipModel: 'Xenova/clip-vit-base-patch32' }
    },
    text: { async generateTags() { return []; }, async summarize() { return ''; }, info() { return { name: 'heuristic', model: 'k' }; } },
    embeddings: { async embedOne() { return []; }, async embedMany() { return []; }, info() { return { name: 'noop', model: 'none', dimensions: 1536 }; } },
    primaryOcr: primary,
    fallbackOcr: fallback,
    visual: {
      async embed() { throw new Error('not implemented'); },
      async warmup() {},
      info() { return { name: 'clip-local', model: 'Xenova/clip-vit-base-patch32', dimensions: 512, loaded: false }; }
    },
    async recognizeWithFallback(_opts: { bytes: Uint8Array; mimeType: string; correlationId?: string }) {
      try {
        const out = await primary.recognize();
        if (out.text && out.text.length > 0) return out;
        if (!overrides.fallbackResult) return out;
        if (fallback === primary) return out;
        const fb = await fallback.recognize();
        if (fb.text && fb.text.length > 0) return fb;
        return out;
      } catch (err) {
        if (!overrides.fallbackResult) throw err;
        if (fallback === primary) throw err;
        return await fallback.recognize();
      }
    },
    tagCache: { get() { return undefined; }, set() {}, has() { return false; }, delete() {}, size() { return 0; }, clear() {} },
    summaryCache: { get() { return undefined; }, set() {}, has() { return false; }, delete() {}, size() { return 0; }, clear() {} },
    embeddingCache: { get() { return undefined; }, set() {}, has() { return false; }, delete() {}, size() { return 0; }, clear() {} },
    ocrCache: { get() { return undefined; }, set() {}, has() { return false; }, delete() {}, size() { return 0; }, clear() {} },
    async health() {
      return {
        config: {
          freeOnly: true,
          demoMode: true,
          text: 'heuristic:deterministic-keyword-v1',
          embeddings: 'noop:none',
          ocr: `${overrides.primaryName ?? 'ocrspace'}:ocrspace-engine-2`,
          visual: 'clip-local:Xenova/clip-vit-base-patch32'
        },
        textReady: false,
        embeddingsReady: false,
        ocrReady: false,
        visualReady: false,
        notes: []
      };
    }
  };
}

function createRepository(quotaRow: { calls_used: number } | null = null) {
  const items = new Map<string, StoredItem>();
  items.set(ITEM_ID, {
    id: ITEM_ID,
    userId: USER_ID,
    status: 'pending',
    type: 'screenshot',
    title: 'capture',
    sourceUrl: null,
    rawText: null,
    ocrText: null,
    ocrEngine: null,
    ocrConfidence: null,
    ocrLanguage: null,
    ocrProcessedAt: null,
    ocrErrorCode: null,
    capturedAt: new Date()
  });
  let bumpCount = 0;
  const repo: ItemRepository = {
    async findById(id) {
      return items.get(id) ?? null;
    },
    async findByClientRequestId() { return null; },
    async createPendingItem() { throw new Error('unused'); },
    async createPendingImageItem() { throw new Error('unused'); },
    async updateStatus(id, status) {
      const item = items.get(id);
      if (item) item.status = status;
    },
    async updateOcrText(id, text, options) {
      const item = items.get(id);
      if (!item) return;
      item.ocrText = text;
      item.ocrEngine = options?.engine ?? null;
      item.ocrConfidence = options?.confidence ?? null;
      item.ocrLanguage = options?.language ?? null;
      item.ocrErrorCode = options?.errorCode ?? null;
      if (!item.ocrProcessedAt) item.ocrProcessedAt = new Date();
    },
    async updateTags() {},
    async saveEmbedding() {},
    async getOcrQuotaForDate() {
      return quotaRow
        ? { userId: USER_ID, quotaDate: '2026-10-03', callsUsed: quotaRow.calls_used }
        : null;
    },
    async bumpOcrQuotaForDate() {
      bumpCount += 1;
      return (quotaRow?.calls_used ?? 0) + bumpCount;
    }
  };
  return { repository: repo, items, getBumpCount: () => bumpCount };
}

function createQueue(): { queue: any; tracker: QueueTracker } {
  const tracker: QueueTracker = { completed: 0, tagEnqueued: false, jobsCreated: [] };
  return {
    tracker,
    queue: {
      async markCompleted() {
        tracker.completed += 1;
      },
      async create(input: any) {
        tracker.jobsCreated.push(input);
        tracker.tagEnqueued = true;
      },
      registerHandler() {}
    }
  };
}

function createStorage(buffer: Buffer | null = Buffer.from('jpgbytes')): ImageStorage {
  return {
    async upload() {},
    async remove() {},
    async download() {
      return buffer;
    },
    async createSignedUrl() {
      return null;
    },
    async createPublicUrl() {
      return null;
    }
  };
}

function createPool(present: boolean): Pool {
  return {
    async query() {
      return {
        rows: present ? [{ storage_key: STORAGE_KEY }] : []
      };
    }
  };
}

describe('OcrHandler (M1 real OCR)', () => {
  it('persists OCR.Space result + bumps quota once', async () => {
    const { repository, items, getBumpCount } = createRepository({ calls_used: 0 });
    const { queue, tracker } = createQueue();
    const ai = createAi({
      primaryResult: { text: 'Hello', engine: 'ocrspace-engine2', confidence: 0.9, language: 'eng' }
    });
    const handler = new OcrHandler({
      queue: queue as any,
      repository,
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: makeOcrStorageKeyResolver(createPool(true))
    });

    await handler.handle({ id: 'job-1', itemId: ITEM_ID, userId: USER_ID, payload: {} });

    const item = items.get(ITEM_ID)!;
    expect(item.ocrText).toBe('Hello');
    expect(item.ocrEngine).toBe('ocrspace-engine2');
    expect(item.ocrLanguage).toBe('eng');
    expect(item.ocrErrorCode).toBeNull();
    expect(getBumpCount()).toBe(1);
    expect(tracker.completed).toBe(1);
    expect(tracker.tagEnqueued).toBe(true);
    expect(tracker.jobsCreated[0].type).toBe('tag');
  });

  it('falls back to tesseract when OCR.Space returns empty', async () => {
    const { repository, items, getBumpCount } = createRepository({ calls_used: 0 });
    const { queue, tracker } = createQueue();
    const ai = createAi({
      primaryResult: { text: '', engine: 'ocrspace-engine2', confidence: 0, language: 'eng' },
      fallbackResult: { text: 'tesseract output', engine: 'tesseract-5', confidence: 0.7, language: 'eng' },
      fallbackName: 'tesseract'
    });
    const handler = new OcrHandler({
      queue: queue as any,
      repository,
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: makeOcrStorageKeyResolver(createPool(true))
    });

    await handler.handle({ id: 'job-2', itemId: ITEM_ID, userId: USER_ID, payload: {} });

    const item = items.get(ITEM_ID)!;
    expect(item.ocrEngine).toBe('tesseract-5');
    expect(item.ocrText).toBe('tesseract output');
    // Tesseract fallback should NOT bump the cloud quota.
    expect(getBumpCount()).toBe(0);
    expect(tracker.completed).toBe(1);
  });

  it('records ocrErrorCode=NO_ASSET but still enqueues tag', async () => {
    const { repository, items } = createRepository();
    const { queue, tracker } = createQueue();
    const ai = createAi({
      primaryResult: { text: 'never', engine: 'ocrspace-engine2', confidence: 0, language: 'eng' }
    });
    const handler = new OcrHandler({
      queue: queue as any,
      repository,
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: makeOcrStorageKeyResolver(createPool(false))
    });

    await handler.handle({ id: 'job-3', itemId: ITEM_ID, userId: USER_ID, payload: {} });

    const item = items.get(ITEM_ID)!;
    expect(item.ocrErrorCode).toBe('NO_ASSET');
    expect(item.ocrText).toBe('');
    expect(tracker.completed).toBe(1);
    expect(tracker.tagEnqueued).toBe(true);
  });

  it('aborts with OCR_QUOTA_EXHAUSTED when daily limit hit', async () => {
    const { repository, items, getBumpCount } = createRepository({ calls_used: 450 });
    const { queue, tracker } = createQueue();
    const ai = createAi({
      primaryResult: { text: 'never', engine: 'ocrspace-engine2', confidence: 0, language: 'eng' }
    });
    const handler = new OcrHandler({
      queue: queue as any,
      repository,
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: makeOcrStorageKeyResolver(createPool(true))
    });

    await handler.handle({ id: 'job-4', itemId: ITEM_ID, userId: USER_ID, payload: {} });

    const item = items.get(ITEM_ID)!;
    expect(item.ocrErrorCode).toBe('OCR_QUOTA_EXHAUSTED');
    expect(getBumpCount()).toBe(0);
    // The job still completes — enrichment failure is not a save failure.
    expect(tracker.completed).toBe(1);
  });

  it('skips non-image items without writing OCR', async () => {
    const { repository, items } = createRepository();
    items.get(ITEM_ID)!.type = 'text';
    const { queue, tracker } = createQueue();
    const ai = createAi({
      primaryResult: { text: 'never', engine: 'ocrspace-engine2', confidence: 0, language: 'eng' }
    });
    const handler = new OcrHandler({
      queue: queue as any,
      repository,
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: makeOcrStorageKeyResolver(createPool(true))
    });

    await handler.handle({ id: 'job-5', itemId: ITEM_ID, userId: USER_ID, payload: {} });

    const item = items.get(ITEM_ID)!;
    expect(item.ocrText).toBeNull();
    expect(item.ocrErrorCode).toBeNull();
    expect(tracker.completed).toBe(1);
    expect(tracker.tagEnqueued).toBe(false);
  });
});