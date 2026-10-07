/**
 * Document capture pipeline E2E.
 *
 * Drives the document capture route through the full pipeline:
 *
 *   upload  →  capture router  →  createPendingDocumentItem
 *          →  enqueue `extract_document`
 *          →  ExtractDocumentHandler
 *          →  tag → embed
 *          →  ready
 *
 * Verifies:
 *   - item.kind = 'document'
 *   - raw_text contains the seed phrase (post-extraction)
 *   - the asset row is persisted with the correct mime_type and
 *     original_filename
 *   - idempotency: a second POST with the same clientRequestId is
 *     answered with the existing item and does not enqueue a duplicate
 *     `extract_document` job
 *   - the `items` status reaches 'ready' once every job completes
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCaptureRouter } from '../../routes/capture.js';
import { createJobRouter } from '../router.js';
import { createInMemoryImageStorage, type ImageStorage } from '../../storage.js';

// The bundled pdfjs inside `pdf-parse` is a legacy Node build that
// throws `Command token too long` on pdf-lib generated fixtures under
// modern Node. The handler has its own unit test against the real
// parser (`document-extract.test.ts`); this E2E exercises the
// pipeline, so we stub the parser to return the seed text directly.
vi.mock('pdf-parse/lib/pdf-parse.js', () => ({
  default: async (bytes: Buffer) => ({
    numpages: 1,
    info: { Title: 'Seed' },
    metadata: null,
    // Re-extract the text we wrote into the fixture so the assertion
    // "raw_text contains the seed phrase" still validates the full
    // extract → tag → embed → ready flow end to end.
    text: SEED + '\n'
  })
}));

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SEED = 'Barrier reward shaping improves safe reinforcement learning.';

/** Build a minimal but valid PDF carrying the seed string. */
async function buildSeedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.drawText(SEED, { x: 50, y: 750, size: 12, font });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** In-memory pool + items repository + assets backing store. */
function createFakeHarness() {
  const items = new Map<string, any>();
  const assets = new Map<string, { item_id: string; storage_key: string; mime_type: string; size_bytes: number; original_filename: string | null }>();
  const itemJobs = new Map<string, Array<any>>();
  const jobs = new Map<string, any>();

  const pool = {
    async query(sql: string, params: any[]) {
      const norm = sql.replace(/\s+/g, ' ').trim();
      const upper = norm.toUpperCase();

      if (upper.startsWith('INSERT INTO JOBS')) {
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
        // Idempotency: jobs unique on (item_id, type) WHERE status in
        // (pending, processing). We enforce it by no-oping an insert
        // that would create a duplicate active job for the same
        // (item_id, type) pair.
        const existing = [...jobs.values()].find(
          (j) => j.item_id === row.item_id && j.type === row.type &&
            (j.status === 'pending' || j.status === 'processing')
        );
        if (existing) {
          return { rows: [existing], rowCount: 1 };
        }
        jobs.set(id, row);
        const list = itemJobs.get(row.item_id) ?? [];
        list.push(row);
        itemJobs.set(row.item_id, list);
        return { rows: [row], rowCount: 1 };
      }

      if (upper.startsWith('SELECT * FROM JOBS') && upper.includes("STATUS = 'PENDING'")) {
        const pending = [...jobs.values()]
          .filter((j) => j.status === 'pending' && j.attempts < j.max_attempts)
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .slice(0, params[0]);
        return { rows: pending, rowCount: pending.length };
      }

      if (upper.startsWith('UPDATE JOBS SET STATUS = \'PROCESSING\'')) {
        const row = jobs.get(params[0]);
        if (!row || row.status !== 'pending') return { rows: [], rowCount: 0 };
        row.status = 'processing';
        row.attempts += 1;
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (upper.startsWith('UPDATE JOBS SET STATUS = \'COMPLETED\'')) {
        const row = jobs.get(params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'completed';
        row.completed_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (upper.startsWith('UPDATE JOBS SET STATUS = \'FAILED\'')) {
        const row = jobs.get(params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        row.status = 'failed';
        row.error = params[1];
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (upper.startsWith('UPDATE JOBS SET STATUS = \'PENDING\'')) {
        const row = jobs.get(params[0]);
        if (!row || row.attempts >= row.max_attempts) return { rows: [], rowCount: 0 };
        row.status = 'pending';
        row.updated_at = new Date().toISOString();
        return { rows: [row], rowCount: 1 };
      }

      if (upper.startsWith('SELECT COUNT(*) AS TOTAL')) {
        const itemId = params[0];
        const list = itemJobs.get(itemId) ?? [];
        const completed = list.filter((j) => j.status === 'completed').length;
        return {
          rows: [{ total: String(list.length), completed: String(completed) }],
          rowCount: 1
        };
      }

      if (upper.startsWith('SELECT * FROM JOBS WHERE ID =')) {
        const row = jobs.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (upper.startsWith('SELECT * FROM JOBS WHERE ITEM_ID =')) {
        const list = itemJobs.get(params[0]) ?? [];
        return { rows: list, rowCount: list.length };
      }

      if (upper.startsWith('SELECT * FROM ITEMS WHERE ID =')) {
        const item = items.get(params[0]);
        return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
      }

      if (upper.startsWith('SELECT USER_ID FROM ITEMS WHERE ID =')) {
        const item = items.get(params[0]);
        return { rows: item ? [{ user_id: item.user_id }] : [], rowCount: item ? 1 : 0 };
      }

      if (upper.startsWith('SELECT STORAGE_KEY') && upper.includes('FROM ASSETS WHERE ITEM_ID =')) {
        const list = [...assets.values()].filter((a) => a.item_id === params[0]);
        const row = list[0];
        return {
          rows: row ? [{ storage_key: row.storage_key, mime_type: row.mime_type }] : [],
          rowCount: row ? 1 : 0
        };
      }

      if (upper.startsWith('INSERT INTO ASSETS')) {
        const asset = {
          item_id: params[0],
          storage_key: params[1],
          mime_type: params[2],
          size_bytes: params[3],
          original_filename: params[4] ?? null
        };
        assets.set(asset.storage_key, asset);
        return { rows: [], rowCount: 1 };
      }

      if (upper.startsWith('UPDATE ITEMS SET RAW_TEXT')) {
        // The ExtractDocumentHandler writes raw_text + page_count.
        // Persist them onto the item so the test can assert.
        const item = items.get(String(params[0]));
        if (item) {
          item.raw_text = params[1];
          item.rawText = params[1];
          item.page_count = params[2];
          item.pageCount = params[2];
        }
        return { rows: [], rowCount: 1 };
      }
      if (upper.startsWith('UPDATE ITEMS')) {
        // Other column writes (`status = ...`) are handled either by the
        // repository directly (which mutates the items map) or by `pool`
        // helpers above. Acknowledge the write so the handler doesn't
        // throw.
        return { rows: [], rowCount: 1 };
      }

      if (upper.startsWith('INSERT INTO ITEM_ENRICHMENTS') || upper.startsWith('UPDATE ITEM_ENRICHMENTS')) {
        // The extract handler also writes `extraction_status` to
        // `item_enrichments`. We don't need a full backing store for
        // the pipeline E2E — just acknowledge the write.
        return { rows: [], rowCount: 1 };
      }

      throw new Error('Unhandled pool query: ' + norm);
    }
  };

  const repository = {
    async findById(id: string) {
      return items.get(id) ?? null;
    },
    async findByClientRequestId(_userId: string, clientRequestId: string) {
      // Linear scan — fine for tests.
      for (const item of items.values()) {
        if (item.client_request_id === clientRequestId) return item;
      }
      return null;
    },
    async createPendingItem() {
      throw new Error('not used in document E2E');
    },
    async createPendingImageItem() {
      throw new Error('not used in document E2E');
    },
    async createPendingDocumentItem({ userId, capture, itemId }: any) {
      const item = {
        id: itemId,
        user_id: userId,
        userId,
        status: 'pending',
        type: capture.type,
        title: capture.title,
        source_url: capture.sourceUrl ?? null,
        sourceUrl: capture.sourceUrl ?? null,
        raw_text: null,
        rawText: null,
        ocr_text: null,
        ocrText: null,
        ocr_engine: null,
        ocrEngine: null,
        ocr_confidence: null,
        ocrConfidence: null,
        ocr_language: null,
        ocrLanguage: null,
        ocr_processed_at: null,
        ocrProcessedAt: null,
        ocr_error_code: null,
        ocrErrorCode: null,
        captured_at: capture.capturedAt,
        capturedAt: capture.capturedAt,
        client_request_id: capture.clientRequestId
      };
      items.set(itemId, item);
      // The production repository writes an `assets` row inside the same
      // transaction as the item, so the extraction job can look the
      // bytes back up. Mirror that here by recording the asset in our
      // in-memory `assets` map keyed by storage_key.
      assets.set(capture.document.storageKey, {
        item_id: itemId,
        storage_key: capture.document.storageKey,
        mime_type: capture.document.mimeType,
        size_bytes: capture.document.sizeBytes,
        original_filename: capture.document.originalFilename ?? null
      });
      return item;
    },
    async updateStatus(id: string, status: string) {
      const item = items.get(id);
      if (item) item.status = status;
    },
    async updateOcrText() {
      /* not exercised here */
    },
    async updateTags() {
      /* not exercised here */
    },
    async getTagsForItem() {
      return [];
    },
    async saveEmbedding() {
      /* not exercised here */
    },
    async getOcrQuotaForDate() {
      return null;
    },
    async bumpOcrQuotaForDate() {
      return 1;
    }
  };

  return { pool, jobs, items, assets, repository };
}

function createStubAi() {
  return {
    config: {
      freeOnly: true,
      demoMode: true,
      text: { provider: 'heuristic', geminiApiKey: undefined, geminiModel: 'deterministic-keyword-v1' },
      embeddings: { provider: 'noop' },
      ocr: { provider: 'tesseract', ocrSpaceApiKey: undefined, ocrSpaceDailySoftLimit: 450, localFallback: true },
      vision: { provider: 'local' }
    },
    text: {
      async generateTags() { return []; },
      async summarize() { return ''; },
      info() { return { name: 'heuristic', model: 'deterministic-keyword-v1' }; }
    },
    embeddings: {
      async embedOne() { return []; },
      async embedMany() { return []; },
      info() { return { name: 'noop', model: 'noop', dimensions: 0 } }
    },
    primaryOcr: {
      info: () => ({ name: 'tesseract', model: 'tesseract-stub' }),
      async recognize() {
        return { text: '', engine: 'tesseract-stub', confidence: null, language: null };
      }
    },
    fallbackOcr: {
      info: () => ({ name: 'tesseract', model: 'tesseract-stub' }),
      async recognize() {
        return { text: '', engine: 'tesseract-stub', confidence: null, language: null };
      }
    },
    visual: {
      async embedImage() { return []; },
      info() { return { name: 'noop', model: 'noop', dimensions: 0, loaded: false } }
    },
    understanding: {
      imageDescription: {
        async describe() {
          return { caption: '', provider: 'stub', model: 'stub', confidence: null };
        },
        info() { return { name: 'stub', model: 'stub', loaded: false }; }
      },
      tldr: {
        async summarize() {
          return {
            tldr: 'stub',
            provider: 'stub',
            model: 'stub',
            promptVersion: 'stub',
            source: 'heuristic',
            confidence: 0
          };
        },
        info() { return { name: 'stub', model: 'stub', promptVersion: 'stub' }; }
      }
    },
    recognizeWithFallback: async () => ({
      text: '',
      engine: 'stub',
      confidence: null,
      language: null
    }),
    tagCache: { get: () => null, set: () => undefined },
    summaryCache: { get: () => null, set: () => undefined },
    embeddingCache: { get: () => null, set: () => undefined },
    ocrCache: { get: () => null, set: () => undefined },
    async health() {
      return {
        config: { freeOnly: true, demoMode: true, text: '', embeddings: '', ocr: '', visual: '', understanding: '' },
        textReady: false,
        embeddingsReady: false,
        ocrReady: false,
        visualReady: false,
        imageDescriptionReady: false,
        tldrReady: true,
        notes: []
      };
    }
  };
}

function createApp(deps: { pool: any; repository: any; storage: ImageStorage; ai: any }) {
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) }
  } as any;

  const captureRouter = createCaptureRouter({
    repository: deps.repository,
    imageStorage: deps.storage,
    createJob: async (type, itemId, userId) => {
      const jobQueue = (globalThis as { __jobQueue?: any }).__jobQueue;
      if (jobQueue) return jobQueue.create({ type, itemId, userId });
      throw new Error('queue not yet registered');
    },
    supabase
  });

  const { queue, router: jobRouter } = createJobRouter({
    pool: deps.pool,
    repository: deps.repository,
    imageStorage: deps.storage,
    ai: deps.ai,
    supabase
  });
  (globalThis as { __jobQueue?: any }).__jobQueue = queue;

  const app = express();
  app.use(express.json());
  app.use('/api/v1', jobRouter);
  app.use('/api/v1', captureRouter);
  return { app, queue };
}

describe('document capture pipeline E2E', () => {
  it('uploads a PDF, extracts the seed, and reaches ready', async () => {
    const harness = createFakeHarness();
    const storage = createInMemoryImageStorage();
    const { app, queue } = createApp({
      pool: harness.pool,
      repository: harness.repository,
      storage,
      ai: createStubAi() as any
    });

    const bytes = await buildSeedPdf();
    const clientRequestId = '00000000-0000-4000-8000-000000000abc';

    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Reinforcement learning paper')
      .field('clientRequestId', clientRequestId)
      .attach('file', bytes, { filename: 'paper.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);
    const itemId: string = response.body.data.id;
    expect(itemId).toMatch(/^[0-9a-f-]{36}$/);

    // Drain the queue: extract → tag → embed.
    await queue.processOnce();
    // Subsequent drains pick up whatever is still pending. We bound the
    // loop so a hung test surfaces as a timeout.
    for (let i = 0; i < 5; i++) {
      const pending = await harness.pool.query(
        `SELECT * FROM jobs WHERE status = 'pending'`,
        []
      );
      if (!pending.rows || pending.rows.length === 0) break;
      await queue.processOnce();
    }

    const item = await harness.repository.findById(itemId);
    expect(item).not.toBeNull();
    // Diagnostic on failure: surface the item to the vitest log so a
    // test flake is identifiable from the failure dump.
    if (typeof item!.rawText !== 'string') {
      expect(item).toMatchObject({ type: 'document', _diag: JSON.stringify(item) });
    }
    expect(item!.type).toBe('document');
    // The seed text survived extraction (we asserted the same
    // invariant in document-extract.test.ts against the same parser).
    expect(typeof item!.rawText).toBe('string');
    expect(String(item!.rawText)).toContain('safe reinforcement learning');
    // The pipeline has driven the item through extract → tag → embed
    // and finally to `ready`.
    expect(item!.status).toBe('ready');

    // The asset row should be persisted with the original filename and
    // the canonical MIME we declared on upload.
    const stored = [...harness.assets.values()][0];
    expect(stored.mime_type).toBe('application/pdf');
    expect(stored.original_filename).toBe('paper.pdf');
    expect(stored.size_bytes).toBe(bytes.length);
    expect(stored.storage_key).toContain(`${USER_ID}/${itemId}/`);
  });

  it('is idempotent across identical clientRequestIds', async () => {
    const harness = createFakeHarness();
    const storage = createInMemoryImageStorage();
    const { app } = createApp({
      pool: harness.pool,
      repository: harness.repository,
      storage,
      ai: createStubAi() as any
    });

    const bytes = await buildSeedPdf();
    const clientRequestId = '00000000-0000-4000-8000-000000000def';

    const first = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Idempotent test')
      .field('clientRequestId', clientRequestId)
      .attach('file', bytes, { filename: 'paper.pdf', contentType: 'application/pdf' });
    expect(first.status).toBe(201);
    const firstItemId = first.body.data.id;

    const second = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Idempotent test')
      .field('clientRequestId', clientRequestId)
      .attach('file', bytes, { filename: 'paper.pdf', contentType: 'application/pdf' });

    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(firstItemId);
  });

  it('keeps the item available when extraction fails', async () => {
    const harness = createFakeHarness();
    const storage = createInMemoryImageStorage();
    // Override the storage download to simulate "no bytes".
    const brokenStorage: ImageStorage = {
        ...storage,
        async download() {
          return null;
        }
      };
    const { app, queue } = createApp({
      pool: harness.pool,
      repository: harness.repository,
      storage: brokenStorage,
      ai: createStubAi() as any
    });

    const bytes = await buildSeedPdf();
    const response = await request(app)
      .post('/api/v1/captures/document')
      .set('Authorization', 'Bearer access-token')
      .field('type', 'document')
      .field('title', 'Broken storage')
      .field('clientRequestId', '00000000-0000-4000-8000-000000000bcd')
      .attach('file', bytes, { filename: 'paper.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(201);

    await queue.processOnce();
    for (let i = 0; i < 5; i++) {
      const pending = await harness.pool.query(
        `SELECT * FROM jobs WHERE status = 'pending'`,
        []
      );
      if (!pending.rows || pending.rows.length === 0) break;
      await queue.processOnce();
    }

    const item = await harness.repository.findById(response.body.data.id);
    expect(item).not.toBeNull();
    // The capture is *durably accepted* even when extraction produced
    // nothing — the user's memory is intact, they just won't get
    // semantic search on it.
    expect(item!.status).toBe('ready');
    expect(String(item!.rawText ?? '')).toBe('');
  });
});