/**
 * Memory Understanding — async job handler.
 *
 * Two-step pipeline that runs after OCR is done:
 *
 *   1. Image description (LocalImageDescriptionProvider)
 *      → persisted in `item_enrichments.caption`.
 *   2. TLDR (DeterministicTldrProvider / OllamaTldrProvider)
 *      → persisted in `item_enrichments.tldr`.
 *
 * For non-image items the caption step is skipped. The TLDR step
 * always runs, so we never leave an item with an empty `tldr` field
 * when the underlying content has any text.
 *
 * Manual TLDR protection: if the existing row has `tldr_source = 'user'`
 * we will NOT overwrite the tldr field. A separate explicit
 * "Regenerate TLDR" path (PATCH) handles the override.
 *
 * A failed caption OR tldr MUST NOT cause the item to fail. The
 * core memory is still usable; we just leave the enrichment row
 * in `failed` state so the UI can surface a retry button.
 */

import type { JobQueue } from '../queue.js';
import type { EnrichmentRepository, ItemEnrichment } from '@mnemonics/database';
import type { ImageStorage } from '../../storage.js';
import type { AiService } from '@mnemonics/ai';
import { DeterministicTldrProvider } from '@mnemonics/ai/providers/understanding';
import { prepareForOcr } from '../image-prep.js';

export interface UnderstandingHandlerDeps {
  queue: JobQueue;
  enrichments: EnrichmentRepository;
  imageStorage: ImageStorage;
  ai: AiService;
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ storage_key: string }> }> };
}

const TYPES_WITH_IMAGE = new Set(['image', 'screenshot']);

/** Minimal projection of `items` that the enrichment pipeline needs. */
interface EnrichmentItem {
  id: string;
  type: string;
  title: string;
  raw_text: string | null;
  ocr_text: string | null;
  source_url: string | null;
  user_id: string;
}

export class UnderstandingHandler {
  constructor(private readonly deps: UnderstandingHandlerDeps) {}

  async handle(job: {
    id: string;
    itemId: string;
    userId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const { itemId, userId } = job;
    await this.deps.enrichments.ensureRow(itemId, userId);
    const existing = await this.deps.enrichments.getForItem(itemId);

    // Load the item ONCE up front. The canonical `type` decides
    // whether a caption is needed, and it is only available here —
    // the job payload does not carry it. Previously this read a
    // lazily-populated cache that was still empty at this point,
    // so `TYPES_WITH_IMAGE.has('')` was always false and image
    // captions were silently skipped forever.
    const item = await this.loadItem(job);
    if (!item) {
      console.warn(`[UnderstandingHandler] item ${itemId} not readable; skipping enrichment`);
      await this.deps.queue.markCompleted(job.id);
      return;
    }

    // 1. caption
    if (TYPES_WITH_IMAGE.has(item.type)) {
      const captionOk = await this.runCaption(job, item, existing);
      if (!captionOk) {
        // Continue to TLDR anyway — the core memory is fine.
        console.warn(`[UnderstandingHandler] caption failed for ${itemId}`);
      }
    }

    // 2. TLDR
    await this.runTldr(job, item, existing);

    await this.deps.queue.markCompleted(job.id);
  }

  private async loadItem(job: { itemId: string }): Promise<EnrichmentItem | null> {
    try {
      const r = await this.deps.pool.query(
        `SELECT id, type, title, raw_text, ocr_text, source_url, user_id
         FROM items WHERE id = $1`,
        [job.itemId]
      );
      const row = r.rows[0] as unknown as EnrichmentItem | undefined;
      if (row) return row;
      return null;
    } catch {
      // The pool may be a test stub without an `items` table.
      // Enrichment is best-effort; returning null here is the
      // right way to opt-out of the work rather than fail the
      // entire pipeline.
      return null;
    }
  }

  private async runCaption(
    job: { id: string; itemId: string; userId: string },
    item: EnrichmentItem,
    existing: ItemEnrichment | null
  ): Promise<boolean> {
    if (existing?.captionStatus === 'ready' && existing.caption) {
      return true;
    }
    if (!TYPES_WITH_IMAGE.has(item.type)) return true;
    const storageRow = await this.deps.pool.query(
      `SELECT storage_key FROM assets WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [job.itemId]
    );
    const storageKey = (storageRow.rows[0] as { storage_key?: string } | undefined)?.storage_key;
    if (!storageKey) {
      await this.deps.enrichments.setCaptionFailure(job.itemId, job.userId, 'NO_ASSET');
      return false;
    }

    let bytes: Uint8Array;
    try {
      const raw = await this.deps.imageStorage.download(storageKey);
      if (!raw) {
        await this.deps.enrichments.setCaptionFailure(job.itemId, job.userId, 'ASSET_NOT_FOUND');
        return false;
      }
      const prep = await prepareForOcr(new Uint8Array(raw), guessMime(storageKey));
      bytes = prep.bytes;
    } catch (err) {
      const code = err instanceof Error ? err.message : 'ASSET_READ_FAILED';
      await this.deps.enrichments.setCaptionFailure(job.itemId, job.userId, code.slice(0, 200));
      return false;
    }

    try {
      const caption = await this.deps.ai.understanding.imageDescription.describe({
        bytes,
        mimeType: guessMime(storageKey)
      });
      await this.deps.enrichments.setCaption(job.itemId, job.userId, {
        caption: caption.caption,
        provider: caption.provider,
        model: caption.model,
        confidence: caption.confidence
      });
      console.log(
        `[UnderstandingHandler] caption ready for ${job.itemId} via ${caption.provider}:${caption.model}`
      );
      return true;
    } catch (err) {
      const code = err instanceof Error ? err.message : 'CAPTION_FAILED';
      await this.deps.enrichments.setCaptionFailure(job.itemId, job.userId, code.slice(0, 200));
      return false;
    }
  }

  private async runTldr(
    job: { id: string; itemId: string; userId: string },
    item: EnrichmentItem,
    existing: ItemEnrichment | null
  ): Promise<void> {
    if (existing?.tldrSource === 'user' && existing.tldr) {
      // user-edited TLDR is protected.
      console.log(`[UnderstandingHandler] preserving user TLDR for ${job.itemId}`);
      return;
    }
    if (existing?.tldrStatus === 'ready' && existing.tldr && existing.tldrSource !== 'heuristic') {
      // Heuristic tldrs are cheap to regenerate; we still skip
      // them when there is no enrichment to add.
      return;
    }

    // Re-read the enrichment row: `runCaption` may have just written
    // a caption, and the TLDR should be composed WITH it. Using the
    // stale `existing` snapshot produced TLDRs that ignored the
    // image description entirely.
    const fresh = await this.deps.enrichments.getForItem(job.itemId);
    const caption = fresh?.caption ?? null;
    const ocrText = item.ocr_text ?? null;
    const rawText = item.raw_text ?? null;
    const title = item.title ?? '';

    // Short-circuit: short notes don't need a model call.
    const composedLength =
      (caption?.length ?? 0) + (ocrText?.length ?? 0) + (rawText?.length ?? 0);
    if (composedLength < 30 && title.length < 60) {
      await this.deps.enrichments.setTldr(job.itemId, job.userId, {
        tldr: title || (rawText ?? '').slice(0, 120) || 'Một memory ngắn đã được lưu.',
        source: 'heuristic',
        provider: 'deterministic',
        model: 'short-circuit-v1',
        promptVersion: 'short-circuit-v1'
      });
      return;
    }

    try {
      const result = await this.deps.ai.understanding.tldr.summarize({
        title,
        caption,
        ocrText,
        rawText,
        sourceUrl: item.source_url,
        type: (item.type as 'link' | 'text' | 'image' | 'screenshot' | 'note' | 'document') ?? 'link',
        locale: 'vi'
      });
      await this.deps.enrichments.setTldr(job.itemId, job.userId, {
        tldr: result.tldr,
        source: result.source,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion
      });
      console.log(
        `[UnderstandingHandler] tldr ready for ${job.itemId} via ${result.provider}:${result.model}`
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : 'TLDR_FAILED';
      // Fall back to the DETERMINISTIC provider specifically. The old
      // code re-called `this.deps.ai.understanding.tldr`, which is the
      // very provider that just failed — so when the configured model
      // was missing (e.g. Ollama 404 for an unpulled `llama3.2:1b`) the
      // retry failed identically and the item was left with
      // `tldr_status = 'failed'` and no summary at all. The
      // deterministic composer needs no model, network, or config, so
      // it is a genuine floor rather than a repeat of the failure.
      try {
        const fallback = new DeterministicTldrProvider().summarize({
          title,
          caption,
          ocrText,
          rawText,
          sourceUrl: item.source_url,
          type: (item.type as 'link' | 'text' | 'image' | 'screenshot' | 'note' | 'document') ?? 'link',
          locale: 'vi'
        });
        const result = await fallback;
        await this.deps.enrichments.setTldr(job.itemId, job.userId, {
          tldr: result.tldr,
          source: 'heuristic',
          provider: result.provider,
          model: result.model,
          promptVersion: result.promptVersion
        });
        console.warn(
          `[UnderstandingHandler] tldr provider failed (${code.slice(0, 120)}); ` +
            `used deterministic fallback for ${job.itemId}`
        );
      } catch {
        await this.deps.enrichments.setFailure(job.itemId, job.userId, code.slice(0, 200));
      }
    }
  }
}

function guessMime(storageKey: string): string {
  const lower = storageKey.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}