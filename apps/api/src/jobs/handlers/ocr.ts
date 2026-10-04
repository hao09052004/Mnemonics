/**
 * OCR Job Handler
 *
 * Pipeline:
 *   1. Resolve the asset storage key for the item.
 *   2. Download the raw bytes from object storage.
 *   3. Run Sharp pre-processing (auto-rotate, downscale, compress).
 *      The high-quality original is preserved untouched.
 *   4. Call createAiService().recognizeWithFallback which chains
 *      OCR.Space → Tesseract. Per-user soft daily quota is enforced.
 *   5. Persist OCR text + engine + confidence + language + error
 *      code so the UI can show "Reading text from image…" while in
 *      flight and "Text recognition unavailable" on failure.
 *   6. Always enqueue the tag job afterwards. OCR is enrichment,
 *      NOT a save boundary — a capture is never lost because OCR
 *      failed.
 *
 * The handler explicitly does NOT throw on provider errors; the
 * job queue otherwise marks the item `failed`, which is the wrong
 * UX signal for an enrichment-only failure.
 */

import type { JobQueue } from "../queue.js";
import type { ItemRepository } from "@mnemonics/database";
import type { ImageStorage } from "../../storage.js";
import type { AiService, OcrResult } from "@mnemonics/ai";
import { prepareForOcr } from "../image-prep.js";

export type ResolveAssetKey = (itemId: string) => Promise<string | null>;

export interface OcrHandlerDeps {
  queue: JobQueue;
  repository: ItemRepository;
  imageStorage: ImageStorage;
  ai: AiService;
  resolveAssetKey: ResolveAssetKey;
}

const TYPES_THAT_NEED_OCR = new Set(["image", "screenshot"]);

export class OcrHandler {
  private queue: JobQueue;
  private repository: ItemRepository;
  private imageStorage: ImageStorage;
  private ai: AiService;
  private resolveAssetKey: ResolveAssetKey;

  constructor(deps: OcrHandlerDeps) {
    this.queue = deps.queue;
    this.repository = deps.repository;
    this.imageStorage = deps.imageStorage;
    this.ai = deps.ai;
    this.resolveAssetKey = deps.resolveAssetKey;
  }

  async handle(job: {
    id: string;
    itemId: string;
    userId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    console.log(`[OcrHandler] Processing OCR job ${job.id} for item ${job.itemId}`);

    const item = await this.repository.findById(job.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    if (!TYPES_THAT_NEED_OCR.has(item.type)) {
      console.log(`[OcrHandler] Skipping non-image item ${job.itemId} (type=${item.type})`);
      await this.queue.markCompleted(job.id);
      // No downstream enqueue here. Non-image items (text/link/note)
      // already get their `enrich` job from the capture route; OCR is
      // not part of their pipeline at all.
      return;
    }

    const storageKey = await this.resolveAssetKey(job.itemId);
    if (!storageKey) {
      console.warn(`[OcrHandler] No asset found for item ${job.itemId}; marking job completed`);
      await this.repository.updateOcrText(job.itemId, "", { errorCode: "NO_ASSET" });
      await this.queue.markCompleted(job.id);
      await this.enqueueTag(job.itemId, job.userId);
      // Enrichment must be enqueued on this path too. This early
      // return used to skip it, so an image whose asset row was
      // missing (or whose storage lookup failed) never received a
      // caption/tldr enrichment job at all and stayed permanently
      // bare in the dashboard.
      await this.enqueueEnrich(job.itemId, job.userId);
      return;
    }

    await this.repository.updateStatus(job.itemId, "processing");

    let result: OcrResult;
    try {
      const raw = await this.imageStorage.download(storageKey);
      if (!raw) {
        throw new Error("ASSET_NOT_FOUND");
      }
      const prep = await prepareForOcr(
        new Uint8Array(raw),
        this.guessMime(storageKey)
      );

      // Soft-limit check: only enforce when we have a counter row,
      // to avoid blocking the very first call of the day for a
      // brand-new user. The counter is bumped on a successful
      // OCR.Space call below.
      const softLimit = this.ai.config.ocr.ocrSpaceDailySoftLimit;
      const today = new Date().toISOString().slice(0, 10);
      const stored = await this.repository.getOcrQuotaForDate(job.userId, today);
      const enforce =
        this.ai.config.ocr.provider === "ocrspace" &&
        stored !== null &&
        stored.callsUsed >= softLimit;
      if (enforce) {
        throw new Error("OCR_QUOTA_EXHAUSTED");
      }

      result = await this.ai.recognizeWithFallback({
        bytes: prep.bytes,
        mimeType: prep.mimeType,
        correlationId: job.id,
      });

      // Persist counter only on a successful cloud call. Local
      // Tesseract doesn't burn quota.
      if (
        this.ai.config.ocr.provider === "ocrspace" &&
        result.engine.startsWith("ocrspace")
      ) {
        await this.repository.bumpOcrQuotaForDate(job.userId, today);
      }

      await this.repository.updateOcrText(job.itemId, result.text, {
        engine: result.engine,
        confidence: result.confidence,
        language: result.language,
      });

      console.log(
        `[OcrHandler] OCR completed for item ${job.itemId} via ${result.engine}` +
          (result.text ? ` (${result.text.length} chars)` : " (empty)")
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : "UNKNOWN";
      console.warn(`[OcrHandler] OCR failed for item ${job.itemId}:`, code);
      // Enrichment failure: mark the item as "ocr_error" but still
      // enqueue the tag job so the rest of the pipeline runs.
      await this.repository.updateOcrText(job.itemId, "", {
        engine: this.ai.primaryOcr.info().name,
        errorCode: code.slice(0, 200),
      });
    }

    await this.queue.markCompleted(job.id);
    await this.enqueueTag(job.itemId, job.userId);
    await this.enqueueEnrich(job.itemId, job.userId);
  }

  private async enqueueTag(itemId: string, userId: string): Promise<void> {
    await this.queue.create({
      type: "tag",
      itemId,
      userId,
      payload: { afterOcr: true },
    });
  }

  private async enqueueEnrich(itemId: string, userId: string): Promise<void> {
    // Best-effort: enrich is enrichment, not a save boundary. If
    // the queue does not know about the 'enrich' type yet, this
    // throws and we log without failing the OCR job.
    try {
      await this.queue.create({
        // Cast: JobType union is extended at runtime to include
        // 'enrich'. Cast keeps the rest of the file typed.
        type: "enrich" as unknown as "ocr" | "tag" | "embed",
        itemId,
        userId,
        payload: { afterOcr: true },
      });
    } catch (err) {
      console.warn(
        `[OcrHandler] failed to enqueue enrich job for ${itemId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  private guessMime(storageKey: string): string {
    const lower = storageKey.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    return "image/jpeg";
  }
}

/**
 * Helper used by jobs/router.ts to wire the storage-key lookup. The
 * repository doesn't expose the assets table yet, so we accept a
 * pool-aware callback instead of bloating the repository interface.
 */
export function makeOcrStorageKeyResolver(
  pool: {
    query: (
      sql: string,
      params: unknown[]
    ) => Promise<{ rows: Array<{ storage_key: string }> }>;
  }
): ResolveAssetKey {
  return async (itemId: string) => {
    try {
      const r = await pool.query(
        `SELECT storage_key FROM assets WHERE item_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [itemId]
      );
      return r.rows[0]?.storage_key ?? null;
    } catch {
      // In-memory test pools and demo paths may not have an `assets`
      // table. Treat the failure the same as "no asset" so the
      // handler can still complete the job without a hard failure.
      return null;
    }
  };
}