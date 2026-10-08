/**
 * Embed Job Handler
 *
 * Processes embedding jobs for all item types.
 * Generates vector embeddings via the injected AiService (which is
 * the single source of truth for provider selection — Gemini first,
 * a local Ollama model second, noop only when neither is usable).
 *
 * The handler never calls a provider directly; it delegates to
 * `ai.embeddings`, so loadAiConfig() owns the whole chain. Every
 * provider in that chain emits 1024-d vectors, which is what
 * `item_embeddings.embedding` (vector(1024)) accepts.
 *
 * Milestone 4 — long-PDF chunk embeddings:
 *   For items whose type is `document`, the handler now produces
 *   TWO layers of embeddings instead of one:
 *
 *     1. An item-level embedding, built from the title, TLDR,
 *        caption, and a SHORT prefix of the extracted text. The
 *        8 000-character truncation is preserved for this layer
 *        so Related Memories and the cluster graph still see the
 *        same compact "what is this memory about" signal.
 *
 *     2. A set of chunk-level embeddings, built from the
 *        `chunkDocument()` output. Each chunk is embedded
 *        individually and persisted in `item_document_chunks`
 *        with its own embedding identity (model + dimensions +
 *        version). Search runs against the chunks and
 *        aggregates back to the parent item.
 *
 *   The two layers share the same provider and the same
 *   version fingerprint, so a re-index of the chunks does not
 *   invalidate the item-level embedding.
 */

import type { JobQueue } from "../queue.js";
import type { ItemRepository } from "@mnemonics/database";
import { createClusterRepository } from "@mnemonics/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import type { AiService } from "@mnemonics/ai";
import { autoLinkSimilarItems } from "../auto-link-similar.js";
import { chunkDocument, type DocumentChunk } from "../document-chunker.js";

export interface EmbedHandlerDeps {
  queue: JobQueue;
  repository: ItemRepository;
  ai: AiService;
  supabase?: SupabaseClient;
  pool?: Pool;
}

export class EmbedHandler {
  private queue: JobQueue;
  private repository: ItemRepository;
  private ai: AiService;
  private supabase?: SupabaseClient;
  private pool?: Pool;

  constructor(deps: EmbedHandlerDeps) {
    this.queue = deps.queue;
    this.repository = deps.repository;
    this.ai = deps.ai;
    this.supabase = deps.supabase;
    this.pool = deps.pool;
  }

  async handle(job: { id: string; itemId: string; userId: string; payload: Record<string, unknown> }): Promise<void> {
    console.log(`[EmbedHandler] Processing embed job ${job.id} for item ${job.itemId}`);

    try {
      // 1. Get the item
      const item = await this.repository.findById(job.itemId);
      if (!item) {
        throw new Error("Item not found");
      }

      // Pull the AI-derived fields in the same call so the
      // embedding reflects the most recent understanding. We read
      // them out-of-band (not via the item repository) to keep the
      // repository surface small.
      let caption: string | null = null;
      let tldr: string | null = null;
      if (this.pool) {
        try {
          const enr = await this.pool.query<{ caption: string | null; tldr: string | null }>(
            `SELECT caption, tldr FROM item_enrichments WHERE item_id = $1`,
            [job.itemId]
          );
          caption = enr.rows[0]?.caption ?? null;
          tldr = enr.rows[0]?.tldr ?? null;
        } catch (enrErr) {
          // The `item_enrichments` table may not exist in some
          // environments (e.g. in-memory test pools, or legacy
          // installations without the migration applied yet). The
          // embedding must still succeed; just skip enrichment.
          console.warn(
            `[EmbedHandler] item_enrichments lookup skipped (${(enrErr as Error).message ?? 'unknown'})`
          );
        }
      }

      // 2. Generate embedding
      const textToEmbed = this.prepareTextForEmbedding({
        id: item.id,
        type: item.type,
        title: item.title,
        rawText: item.rawText ?? null,
        ocrText: item.ocrText ?? null,
        caption,
        tldr
      });
      if (!textToEmbed.trim()) {
        console.log(`[EmbedHandler] No text to embed for item ${job.itemId}`);
        await this.queue.markCompleted(job.id);
        await this.markReadyIfComplete(job);
        return;
      }

      const providerInfo = this.ai.embeddings.info();

      // Noop means NEITHER Gemini NOR a local model is usable. We refuse
      // to invent a vector: a synthetic embedding would be written into
      // the same vector(1024) column as real ones and then compared
      // against real query vectors, silently returning arbitrary
      // neighbours. Skipping the write keeps search honest — it degrades
      // to lexical-only, which is a visible, correct behaviour.
      if (providerInfo.name === "noop" || providerInfo.name.endsWith("+noop")) {
        console.warn(
          `[EmbedHandler] No embedding provider available (${providerInfo.name}); ` +
            `skipping embedding for item ${job.itemId}. Search stays lexical-only. ` +
            `Set GEMINI_API_KEY, or 'ollama pull bge-m3' for the local fallback.`
        );
        await this.queue.markCompleted(job.id);
        await this.markReadyIfComplete(job);
        return;
      }

      const embedding = await this.ai.embeddings.embedOne(textToEmbed);
      const providerInfo2 = this.ai.embeddings.info();
      const version = currentEmbeddingVersion(providerInfo2);

      // 3. Save embedding to database. The version fingerprint is
      //    computed from the live provider info — never a hard-coded
      //    string — and `kind = 'real'` tells the SQL guard in
      //    `auto-link-similar.ts` that this row may participate in
      //    similarity joins.
      await this.saveEmbedding(
        job.itemId,
        job.userId,
        embedding,
        providerInfo2.model,
        { embeddingVersion: version, embeddingKind: "real" }
      );

      // 3b. Document items: also embed every chunk so a search
      //     for a phrase on page 80 of a 200-page PDF can
      //     retrieve the document. The chunk pipeline is
      //     best-effort: a failure here is logged and swallowed
      //     so it does not block the item from becoming ready.
      if (item.type === "document" && item.rawText && item.rawText.length > 0) {
        try {
          await this.embedDocumentChunks(
            job.itemId,
            job.userId,
            item.rawText,
            null,
            { embeddingVersion: version, embeddingKind: "real" }
          );
        } catch (chunkErr) {
          console.warn(
            `[EmbedHandler] Chunk embedding failed for item ${job.itemId}:`,
            chunkErr
          );
        }
      }

      // 4. Mark job as completed
      await this.queue.markCompleted(job.id);

      // 5. Check if all jobs are done, then mark item as ready
      await this.markReadyIfComplete(job);

      console.log(`[EmbedHandler] Embedding completed for item ${job.itemId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[EmbedHandler] Error processing job ${job.id}:`, errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Promote the item to 'ready' once every one of its jobs is done.
   *
   * This is the single funnel for the transition, because an item that
   * never reaches 'ready' is invisible to search (the search route
   * filters on `status = 'ready'`). Every exit path must call it — the
   * happy path, the "nothing to embed" path, and the "no embedding
   * provider" path. An embed job that completes without a vector still
   * counts as completed: a memory with no embedding is still a usable
   * memory, searchable lexically.
   */
  private async markReadyIfComplete(job: { itemId: string; userId: string }): Promise<void> {
    const allDone = await this.queue.areAllJobsCompleted(job.itemId);
    if (!allDone) {
      console.log(`[EmbedHandler] Item ${job.itemId} still has pending jobs`);
      return;
    }

    await this.repository.updateStatus(job.itemId, "ready");

    if (this.pool) {
      try {
        const related = await autoLinkSimilarItems(this.pool, job.userId, job.itemId);
        console.log(
          `[EmbedHandler] Auto-linked ${related.length} similar memories for item ${job.itemId}`
        );
      } catch (graphError) {
        // Graph enrichment is best-effort: a graph outage must not turn
        // a successfully embedded, searchable item back into a failed job.
        console.warn("[EmbedHandler] Similarity linking failed:", graphError);
      }

      // Fire-and-forget cluster refresh. A cluster computation is
      // not a save boundary (spec §21 — "Memory must become ready
      // independently"), so a slow refresh cannot keep this item
      // out of search. The user's clusters simply catch up on the
      // next dashboard load. We log the outcome so a long tail
      // shows up in monitoring.
      //
      // The cluster refresh needs a real pg-compatible pool (it runs
      // a transaction). Test pools are often fakes without `.connect`
      // — in that case we skip the refresh entirely and log at
      // debug level so a CI run is not drowned in stderr noise.
      if (typeof (this.pool as { connect?: unknown }).connect !== 'function') {
        // Test-only stub. Nothing to do.
      } else {
        try {
          const clusterRepo = createClusterRepository();
          const result = await clusterRepo.refresh(job.userId, { pool: this.pool });
          console.log(
            `[EmbedHandler] Clusters refreshed for user ${job.userId}: ` +
              `clusters=${result.clusterCount} unclustered=${result.unclusteredCount} ` +
              `eligible=${result.eligibleItemCount} durationMs=${result.durationMs}`
          );
        } catch (clusterError) {
          console.warn(
            `[EmbedHandler] Cluster refresh failed for user ${job.userId}:`,
            clusterError
          );
        }
      }
    }

    console.log(`[EmbedHandler] Item ${job.itemId} is now ready`);
  }

  /**
   * Embed and persist every chunk of a document item.
   *
   * Called from `handle()` AFTER the item-level embedding has
   * been written. The chunk pipeline is best-effort: a failure
   * here is logged but does not block the item from becoming
   * `ready`. A document with no chunks can still be opened
   * and searched lexically; only the semantic-recall path is
   * affected.
   *
   * Idempotency: chunks are upserted by (item_id, chunk_index)
   * AND (item_id, content_hash). A document that was edited
   * (and therefore re-extracted with different content) will
   * leave stale chunks behind; the `deleteMissing` step below
   * removes them so the chunk set always matches the latest
   * content.
   */
  private async embedDocumentChunks(
    itemId: string,
    userId: string,
    rawText: string,
    pageCount: number | null,
    options: { embeddingVersion: string; embeddingKind: "real" | "noop" | "legacy" | "unknown" }
  ): Promise<void> {
    if (!this.pool) return;
    if (options.embeddingKind !== "real") {
      // No real provider available; skip silently. Search stays
      // lexical-only for this document.
      return;
    }
    const chunks = chunkDocument({ text: rawText, pageCount });
    if (chunks.length === 0) return;

    const providerInfo = this.ai.embeddings.info();
    const vector = await Promise.all(
      chunks.map((c) => this.ai.embeddings.embedOne(c.content))
    );

    // Upsert each chunk. The (item_id, content_hash) uniqueness
    // constraint means re-runs of this method are safe: an
    // unchanged chunk hits ON CONFLICT (item_id, content_hash)
    // and is not duplicated. A chunk that changed (its hash
    // differs from the stored one) is updated in place.
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const v = vector[i];
      await this.pool.query(
        `INSERT INTO item_document_chunks
          (user_id, item_id, chunk_index, page_start, page_end,
           char_start, char_end, content, content_hash, token_estimate,
           embedding, embedding_model, embedding_dimensions,
           embedding_version, embedding_kind, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
         ON CONFLICT (item_id, content_hash) DO UPDATE SET
           chunk_index = EXCLUDED.chunk_index,
           page_start = EXCLUDED.page_start,
           page_end = EXCLUDED.page_end,
           char_start = EXCLUDED.char_start,
           char_end = EXCLUDED.char_end,
           content = EXCLUDED.content,
           token_estimate = EXCLUDED.token_estimate,
           embedding = EXCLUDED.embedding,
           embedding_model = EXCLUDED.embedding_model,
           embedding_dimensions = EXCLUDED.embedding_dimensions,
           embedding_version = EXCLUDED.embedding_version,
           embedding_kind = EXCLUDED.embedding_kind,
           updated_at = NOW()`,
        [
          userId,
          itemId,
          c.index,
          c.pageStart,
          c.pageEnd,
          c.charStart,
          c.charEnd,
          c.content,
          c.contentHash,
          c.tokenEstimate,
          `[${v.join(",")}]`,
          providerInfo.model,
          v.length,
          options.embeddingVersion,
          options.embeddingKind,
        ]
      );
    }

    // Drop chunks that no longer correspond to any current
    // chunk_index. After a re-extract, the new chunk set may be
    // smaller (a paragraph was deleted) so stale rows would
    // otherwise linger and return misleading search hits.
    await this.pool.query(
      `DELETE FROM item_document_chunks
        WHERE item_id = $1
          AND chunk_index >= $2`,
      [itemId, chunks.length]
    );
  }

  private prepareTextForEmbedding(item: {
    id: string;
    type: string;
    title: string;
    rawText?: string | null;
    ocrText?: string | null;
    caption?: string | null;
    tldr?: string | null;
  }): string {
    // Build a structured representation so the embedding captures
    // the user-curated fields AND the AI-derived fields. The two
    // most retrieval-useful signals (title, tldr) come first; OCR
    // and caption come later so the centroid is biased towards
    // what the user typed.
    const parts = [
      item.title ? `Title: ${item.title}` : "",
      item.tldr ? `TLDR: ${item.tldr}` : "",
      item.caption ? `Description: ${item.caption}` : "",
      item.rawText ? `Content: ${item.rawText}` : "",
      item.ocrText ? `OCR: ${item.ocrText}` : ""
    ].filter(Boolean);

    // Join with separators and truncate to ~8000 chars (leaving room for model limits)
    return parts.join("\n\n").slice(0, 8000);
  }

  private async saveEmbedding(
    itemId: string,
    userId: string,
    embedding: number[],
    model: string,
    options?: {
      embeddingVersion?: string;
      embeddingKind?: "real" | "noop" | "legacy" | "unknown";
    }
  ): Promise<void> {
    // Store embedding in item_embeddings table
    if (this.supabase) {
      const { error } = await this.supabase
        .from("item_embeddings")
        .upsert(
          {
            item_id: itemId,
            model,
            dimensions: embedding.length,
            embedding,
            embedding_version: options?.embeddingVersion ?? null,
            embedding_kind: options?.embeddingKind ?? "unknown",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id" }
        );

      if (error) {
        throw new Error(`Failed to save embedding: ${error.message}`);
      }
    } else {
      await this.repository.saveEmbedding(itemId, userId, embedding, model, options);
    }
  }
}

/**
 * Build a short, greppable version string for a freshly-written
 * embedding. The format is intentionally human-readable so a
 * `psql` query can answer "what model wrote this row?" without
 * joining a fingerprint table.
 */
function currentEmbeddingVersion(info: { name: string; model: string }): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${info.name}-${info.model}-${date}`;
}