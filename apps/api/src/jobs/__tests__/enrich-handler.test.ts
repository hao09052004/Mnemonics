/**
 * Enrichment handler regression tests.
 *
 * These lock in three bugs that each silently produced a blank item in
 * the dashboard:
 *
 *  1. `handle()` decided whether to caption by reading a lazily-populated
 *     type cache that was still EMPTY at that point. `TYPES_WITH_IMAGE
 *     .has('')` is always false, so image captions were never generated.
 *  2. The OCR handler's "no asset" early return enqueued `tag` but not
 *     `enrich`, so those items never received any enrichment at all.
 *  3. The TLDR catch block "fell back" by re-calling the SAME provider
 *     that just failed. A missing Ollama model therefore produced
 *     `tldr_status = 'failed'` instead of a deterministic summary.
 */

import { describe, it, expect } from 'vitest';
import { UnderstandingHandler } from '../handlers/enrich.js';
import { OcrHandler, makeOcrStorageKeyResolver } from '../handlers/ocr.js';
import type { ItemEnrichment, EnrichmentRepository } from '@mnemonics/database';
import type { ImageStorage } from '../../storage.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

interface ItemRow {
  id: string;
  type: string;
  title: string;
  raw_text: string | null;
  ocr_text: string | null;
  source_url: string | null;
  user_id: string;
}

function createItem(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 'item-1',
    type: 'screenshot',
    title: 'Facebook · vùng cắt',
    raw_text: null,
    ocr_text: 'Nội dung nhận diện từ ảnh chụp màn hình',
    source_url: 'https://facebook.com/story/123',
    user_id: USER_ID,
    ...overrides
  };
}

/**
 * Pool stub that answers the two queries the handler makes:
 * the `items` lookup and the `assets` storage-key lookup.
 */
function createPool(item: ItemRow | null, storageKey: string | null) {
  return {
    async query(sql: string, _params: unknown[]) {
      if (/FROM items/i.test(sql)) {
        return { rows: item ? [item] : [] };
      }
      if (/FROM assets/i.test(sql)) {
        return { rows: storageKey ? [{ storage_key: storageKey }] : [] };
      }
      return { rows: [] };
    }
  } as any;
}

function createEnrichments(existing: Partial<ItemEnrichment> | null = null) {
  const calls = { caption: 0, tldr: 0, completed: 0 };
  const base: ItemEnrichment = {
    itemId: 'item-1',
    userId: USER_ID,
    caption: null,
    captionProvider: null,
    captionModel: null,
    captionConfidence: null,
    captionStatus: 'pending',
    captionErrorCode: null,
    captionCreatedAt: null,
    captionUpdatedAt: null,
    tldr: null,
    tldrSource: 'pending',
    tldrProvider: null,
    tldrModel: null,
    tldrPromptVersion: null,
    tldrStatus: 'pending',
    tldrErrorCode: null,
    tldrCreatedAt: null,
    tldrUpdatedAt: null,
    summary: null,
    summaryProvider: null,
    summaryModel: null,
    summaryStatus: 'pending',
    promptVersion: null,
    processingVersion: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const repo = {
    async ensureRow() {},
    async getForItem() {
      return existing ? { ...base, ...existing } : null;
    },
    async setCaption(_id: string, _u: string, v: { caption: string }) {
      calls.caption += 1;
      existing = {
        ...base,
        ...existing,
        caption: v.caption,
        captionStatus: 'ready' as const,
        captionModel: 'test-model'
      };
    },
    async setCaptionFailure(_id: string, _u: string, _code: string) {
      calls.caption += 1;
    },
    async setTldr(_id: string, _u: string, v: { tldr: string; source: string }) {
      calls.tldr += 1;
      existing = {
        ...base,
        ...existing,
        tldr: v.tldr,
        tldrSource: v.source as ItemEnrichment['tldrSource'],
        tldrStatus: 'ready' as const
      };
    },
    async setUserTldr() {},
    async setFailure() {},
    async listTextForEmbedding() {
      return [];
    }
  } satisfies EnrichmentRepository;
  return { repo, calls };
}

function createQueue() {
  const calls = { completed: 0, created: [] as any[] };
  return {
    calls,
    queue: {
      async markCompleted() {
        calls.completed += 1;
      },
      async create(input: any) {
        calls.created.push(input);
      }
    } as any
  };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createStorage(): ImageStorage {
  return {
    async upload() {},
    async remove() {},
    async download() {
      return Buffer.from(PNG_BYTES);
    },
    async createSignedUrl() {
      return null;
    },
    async createPublicUrl() {
      return null;
    }
  } as ImageStorage;
}

function createAi(overrides: { describeThrows?: boolean; tldrThrows?: boolean } = {}) {
  return {
    config: { ocr: { provider: 'tesseract', ocrSpaceDailySoftLimit: 450 } },
    understanding: {
      imageDescription: {
        async describe() {
          if (overrides.describeThrows) throw new Error('ASSET_READ_FAILED');
          return { caption: 'một ảnh chụp màn hình', provider: 'local', model: 'test-model', confidence: 0.5 };
        },
        info() {
          return { name: 'local', model: 'test-model', loaded: true };
        }
      },
      tldr: {
        async summarize() {
          if (overrides.tldrThrows) throw new Error("model 'llama3.2:1b' not found");
          return {
            tldr: 'Tóm tắt thử nghiệm',
            provider: 'ollama',
            model: 'llama3.2:1b',
            promptVersion: 'ollama-tldr-v1',
            source: 'local_ai' as const,
            confidence: 0.7
          };
        },
        info() {
          return { name: 'ollama', model: 'llama3.2:1b', promptVersion: 'ollama-tldr-v1' };
        }
      }
    }
  } as any;
}

describe('UnderstandingHandler', () => {
  it('captions image items (regression: empty type cache skipped captions)', async () => {
    const { repo, calls } = createEnrichments();
    const { queue, calls: qCalls } = createQueue();
    const handler = new UnderstandingHandler({
      queue,
      enrichments: repo,
      imageStorage: createStorage(),
      ai: createAi(),
      pool: createPool(createItem({ type: 'screenshot' }), 'key/shot.png')
    });

    await handler.handle({ id: 'job-1', itemId: 'item-1', userId: USER_ID, payload: {} });

    expect(calls.caption).toBe(1);
    expect(calls.tldr).toBe(1);
    expect(qCalls.completed).toBe(1);
  });

  it('captions "image" type as well as "screenshot"', async () => {
    const { repo, calls } = createEnrichments();
    const { queue } = createQueue();
    const handler = new UnderstandingHandler({
      queue,
      enrichments: repo,
      imageStorage: createStorage(),
      ai: createAi(),
      pool: createPool(createItem({ type: 'image' }), 'key/pic.png')
    });

    await handler.handle({ id: 'job-2', itemId: 'item-1', userId: USER_ID, payload: {} });

    expect(calls.caption).toBe(1);
  });

  it('does NOT caption text items', async () => {
    const { repo, calls } = createEnrichments();
    const { queue } = createQueue();
    const handler = new UnderstandingHandler({
      queue,
      enrichments: repo,
      imageStorage: createStorage(),
      ai: createAi(),
      pool: createPool(createItem({ type: 'text', raw_text: 'ghi chú của tôi' }), null)
    });

    await handler.handle({ id: 'job-3', itemId: 'item-1', userId: USER_ID, payload: {} });

    expect(calls.caption).toBe(0);
    expect(calls.tldr).toBe(1);
  });

  it('composes the TLDR from the caption it just generated', async () => {
    const { repo } = createEnrichments();
    const { queue } = createQueue();
    let seenCaption: string | null = null;
    const ai = createAi();
    ai.understanding.tldr.summarize = async (input: any) => {
      seenCaption = input.caption;
      return {
        tldr: 'x',
        provider: 'deterministic',
        model: 'm',
        promptVersion: 'p',
        source: 'heuristic' as const,
        confidence: 0.4
      };
    };
    const handler = new UnderstandingHandler({
      queue,
      enrichments: repo,
      imageStorage: createStorage(),
      ai,
      pool: createPool(createItem(), 'key/shot.png')
    });

    await handler.handle({ id: 'job-4', itemId: 'item-1', userId: USER_ID, payload: {} });

    expect(seenCaption).toBe('một ảnh chụp màn hình');
  });

  it('falls back to a deterministic TLDR when the provider fails (regression: retried the same failing provider)', async () => {
    const { repo, calls } = createEnrichments();
    const { queue, calls: qCalls } = createQueue();
    let tldrText: string | null = null;
    const repoSpy = {
      ...repo,
      async setTldr(_id: string, _u: string, v: { tldr: string }) {
        calls.tldr += 1;
        tldrText = v.tldr;
      }
    } as EnrichmentRepository;

    const handler = new UnderstandingHandler({
      queue,
      enrichments: repoSpy,
      imageStorage: createStorage(),
      ai: createAi({ tldrThrows: true }),
      pool: createPool(createItem(), 'key/shot.png')
    });

    await handler.handle({ id: 'job-5', itemId: 'item-1', userId: USER_ID, payload: {} });

    // A summary must still be produced, and the job must complete
    // rather than leaving tldr_status='failed'.
    expect(tldrText).toBeTruthy();
    expect(String(tldrText).length).toBeGreaterThan(0);
    expect(qCalls.completed).toBe(1);
  });

  it('completes without throwing when the item row is unreadable', async () => {
    const { repo } = createEnrichments();
    const { queue, calls: qCalls } = createQueue();
    const handler = new UnderstandingHandler({
      queue,
      enrichments: repo,
      imageStorage: createStorage(),
      ai: createAi(),
      pool: createPool(null, null)
    });

    await expect(
      handler.handle({ id: 'job-6', itemId: 'item-1', userId: USER_ID, payload: {} })
    ).resolves.toBeUndefined();
    expect(qCalls.completed).toBe(1);
  });

  it('records a caption failure but still completes the job', async () => {
    const { repo, calls } = createEnrichments();
    const { queue, calls: qCalls } = createQueue();
    const handler = new UnderstandingHandler({
      queue,
      enrichments: repo,
      imageStorage: createStorage(),
      ai: createAi({ describeThrows: true }),
      pool: createPool(createItem(), 'key/shot.png')
    });

    await handler.handle({ id: 'job-7', itemId: 'item-1', userId: USER_ID, payload: {} });

    expect(calls.caption).toBe(1);
    expect(qCalls.completed).toBe(1);
  });
});

describe('OcrHandler enrich fan-out', () => {
  function createRepositoryStub(type: string) {
    return {
      async findById() {
        return { id: 'item-1', userId: USER_ID, type, status: 'pending' };
      },
      async updateStatus() {},
      async updateOcrText() {},
      async getOcrQuotaForDate() {
        return null;
      },
      async bumpOcrQuotaForDate() {}
    } as any;
  }

  const ai = {
    config: { ocr: { provider: 'tesseract', ocrSpaceDailySoftLimit: 450 } },
    primaryOcr: { info: () => ({ name: 'tesseract', model: 'tess' }) },
    async recognizeWithFallback() {
      return { text: '', engine: 'tesseract', confidence: 0, language: 'eng' };
    }
  } as any;

  it('enqueues enrich when the asset is missing (regression: item never enriched)', async () => {
    const { queue, calls } = createQueue();
    const handler = new OcrHandler({
      queue,
      repository: createRepositoryStub('screenshot'),
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: makeOcrStorageKeyResolver({
        query: async () => ({ rows: [] })
      } as any)
    });

    await handler.handle({ id: 'job-8', itemId: 'item-1', userId: USER_ID, payload: {} });

    const types = calls.created.map((j: any) => j.type);
    expect(types).toContain('tag');
    expect(types).toContain('enrich');
  });

  it('enqueues enrich on the happy OCR path', async () => {
    const { queue, calls } = createQueue();
    const handler = new OcrHandler({
      queue,
      repository: createRepositoryStub('image'),
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: async () => 'key/pic.png'
    });

    await handler.handle({ id: 'job-9', itemId: 'item-1', userId: USER_ID, payload: {} });

    const types = calls.created.map((j: any) => j.type);
    expect(types).toContain('tag');
    expect(types).toContain('enrich');
  });

  it('does not enqueue anything for a non-image item', async () => {
    const { queue, calls } = createQueue();
    const handler = new OcrHandler({
      queue,
      repository: createRepositoryStub('text'),
      imageStorage: createStorage(),
      ai,
      resolveAssetKey: async () => 'key/x.png'
    });

    await handler.handle({ id: 'job-10', itemId: 'item-1', userId: USER_ID, payload: {} });

    expect(calls.created).toHaveLength(0);
  });
});
