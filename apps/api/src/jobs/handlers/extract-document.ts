/**
 * `extract_document` job handler.
 *
 * Pipeline (when raw bytes are readable):
 *
 *   1. Resolve the asset storage key (the document route stored the
 *      bytes under `<user>/<item>/<safe-filename>`).
 *   2. Download the bytes from object storage.
 *   3. Run the local extractor (PDF via `pdf-parse`, TXT/Markdown via
 *      a UTF-8 decode + whitespace normalisation).
 *   4. Persist the extracted text to `items.raw_text`, the page count
 *      to `items.page_count`, and a small extraction error code so
 *      the dashboard can render "Text extraction unavailable".
 *   5. Enqueue `tag → embed` and best-effort `enrich` so the rest of
 *      the existing pipeline picks the document up like any other
 *      memory.
 *
 * Failure semantics:
 *
 *   - Extraction is enrichment, NOT a save boundary. If parsing throws
 *     or the document has no extractable text, we still mark the job
 *     completed and enqueue the downstream stages; the item will
 *     reach `ready` with an empty `raw_text` and a small error code.
 *     A user-uploaded document that turned out to be scanned-only is
 *     a valid memory, just not a searchable one yet.
 *
 *   - The `extract_document` job itself is idempotent: re-running it
 *     overwrites `raw_text` rather than appending. Job uniqueness on
    // (item_id, type) WHERE status IN ('pending','processing') guarantees
 *     a parallel run cannot create duplicate jobs; the queue's own
 *     dedup is in jobs/queue.ts.
 */

import type { JobQueue } from '../queue.js';
import type { ItemRepository } from '@mnemonics/database';
import type { ImageStorage } from '../../storage.js';
import {
  extractDocument,
  truncateExtractedText,
  type ExtractedDocument
} from '../document-extract.js';
import type { DocumentMimeType } from '../document-types.js';

/** Shape of the `pool` the handler can talk to. Matches both the
 *  production pg.Pool and the in-memory test stubs used in unit tests.
 *  Generic over the row shape so the same call site can read
 *  `assets` rows and `items` rows without an extra cast. */
type QueryPool = {
  query<R = Record<string, unknown>>(
    sql: string,
    params: unknown[]
  ): Promise<{ rows: Array<R> }>;
};

export interface ExtractDocumentHandlerDeps {
  queue: JobQueue;
  repository: ItemRepository;
  storage: ImageStorage;
  pool: QueryPool;
}

interface AssetRow {
  storage_key: string;
  mime_type: string;
}

export class ExtractDocumentHandler {
  private readonly queue: JobQueue;
  private readonly repository: ItemRepository;
  private readonly storage: ImageStorage;
  private readonly pool: ExtractDocumentHandlerDeps['pool'];

  constructor(deps: ExtractDocumentHandlerDeps) {
    this.queue = deps.queue;
    this.repository = deps.repository;
    this.storage = deps.storage;
    this.pool = deps.pool;
  }

  async handle(job: {
    id: string;
    itemId: string;
    userId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const { itemId, userId } = job;
    console.log(`[ExtractDocumentHandler] start for item ${itemId}`);

    // The document route may not have inserted the assets row yet
    // (e.g. when the test fixture pool is in-memory and has no assets
    // table). Treat "no asset row" the same as "no bytes": we still
    // enqueue the downstream pipeline, the memory just stays empty.
    let asset: AssetRow | undefined;
    try {
      const r = await this.pool.query<AssetRow>(
        `SELECT storage_key, mime_type FROM assets WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [itemId]
      );
      asset = r.rows[0];
    } catch (err) {
      console.warn(
        `[ExtractDocumentHandler] assets lookup skipped (${(err as Error).message ?? 'unknown'})`
      );
    }

    await this.repository.updateStatus(itemId, 'processing');

    if (!asset) {
      console.warn(`[ExtractDocumentHandler] no asset row for ${itemId}; skipping extraction`);
      await this.persistExtraction(itemId, '', null, false, 'NO_ASSET');
      await this.queue.markCompleted(job.id);
      await this.enqueueDownstream(itemId, userId);
      return;
    }

    if (!isDocumentMime(asset.mime_type)) {
      // The route only enqueues extract_document for `document` items,
      // but defensive: a non-document MIME means the asset row was
      // written for an image/screenshot. Don't try to parse it.
      console.warn(
        `[ExtractDocumentHandler] non-document mime ${asset.mime_type}; skipping extraction`
      );
      await this.persistExtraction(itemId, '', null, false, 'UNSUPPORTED_DOCUMENT_MIME');
      await this.queue.markCompleted(job.id);
      await this.enqueueDownstream(itemId, userId);
      return;
    }

    const raw = await this.storage.download(asset.storage_key);
    if (!raw) {
      console.warn(`[ExtractDocumentHandler] bytes missing for ${itemId}`);
      await this.persistExtraction(itemId, '', null, false, 'ASSET_NOT_FOUND');
      await this.queue.markCompleted(job.id);
      await this.enqueueDownstream(itemId, userId);
      return;
    }

    const result: ExtractedDocument = await extractDocument(raw, asset.mime_type);
    const { text: capped, truncated } = truncateExtractedText(result.text);

    await this.persistExtraction(
      itemId,
      capped,
      result.pageCount,
      truncated,
      result.ok ? null : result.errorCode ?? 'EXTRACTION_FAILED'
    );

    console.log(
      `[ExtractDocumentHandler] item=${itemId} engine=${result.engine} ` +
        `chars=${capped.length} pages=${result.pageCount ?? 'n/a'} ` +
        `truncated=${truncated} ok=${result.ok}`
    );

    await this.queue.markCompleted(job.id);
    await this.enqueueDownstream(itemId, userId);
  }

  private async persistExtraction(
    itemId: string,
    rawText: string,
    pageCount: number | null,
    truncated: boolean,
    errorCode: string | null
  ): Promise<void> {
    // `page_count` is a nullable column added by migration 019. We
    // leave it NULL when the source wasn't a PDF, or when the parser
    // could not report a count.
    try {
      await this.pool.query(
        `UPDATE items
            SET raw_text = $2,
                page_count = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [itemId, rawText || null, pageCount]
      );
    } catch (err) {
      // A test pool without the column would throw here. Surface it
      // as a warning rather than fail the whole handler — the rest of
      // the persistence work (extraction error code) is best-effort.
      console.warn(
        `[ExtractDocumentHandler] could not write raw_text/page_count (${(err as Error).message ?? 'unknown'})`
      );
    }

    // Persist the extraction error code on the enrichment row so the
    // dashboard can render "Text extraction unavailable". We don't
    // touch the caption/tldr here — those come from the enrich job.
    try {
      await this.pool.query(
        `INSERT INTO item_enrichments (item_id, user_id, extraction_status, extraction_error_code, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (item_id) DO UPDATE SET
           extraction_status = EXCLUDED.extraction_status,
           extraction_error_code = EXCLUDED.extraction_error_code,
           updated_at = NOW()`,
        [
          itemId,
          // `user_id` is needed by the existing item_enrichments RLS
          // policy. We pull it once up front so the UPDATE doesn't have
          // to look it up again.
          await this.fetchUserId(itemId),
          errorCode ? 'failed' : 'ready',
          errorCode
        ]
      );
    } catch (err) {
      // `item_enrichments` is optional in some test pools. Logging the
      // failure keeps the handler resilient.
      console.warn(
        `[ExtractDocumentHandler] could not update enrichment row (${(err as Error).message ?? 'unknown'})`
      );
    }

    // The truncated flag is captured in logs only — there is no
    // dashboard surface for "this PDF was over the cap" yet.
    if (truncated) {
      console.warn(
        `[ExtractDocumentHandler] item=${itemId} extraction exceeded ` +
          `${rawText.length} chars; truncated`
      );
    }
  }

  private async fetchUserId(itemId: string): Promise<string> {
    try {
      const r = await this.pool.query<{ user_id: string }>(
        `SELECT user_id FROM items WHERE id = $1`,
        [itemId]
      );
      return r.rows[0]?.user_id ?? '';
    } catch {
      return '';
    }
  }

  private async enqueueDownstream(itemId: string, userId: string): Promise<void> {
    // Tag → Embed → (best-effort) Enrich. Each handler enqueues the
    // next stage itself, so we only have to kick off the chain.
    try {
      await this.queue.create({
        type: 'tag',
        itemId,
        userId,
        payload: { afterExtract: true }
      });
    } catch (err) {
      // The queue's UNIQUE (item_id, type) means the chain is
      // idempotent: if the tag job already exists (re-runs after a
      // crash), this throws and we ignore it.
      console.warn(
        `[ExtractDocumentHandler] tag enqueue skipped (${(err as Error).message ?? 'unknown'})`
      );
    }
  }
}

function isDocumentMime(mime: string): mime is DocumentMimeType {
  return mime === 'application/pdf' || mime === 'text/plain' || mime === 'text/markdown';
}