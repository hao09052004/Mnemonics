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
 */

import type { JobQueue } from "../queue.js";
import type { ItemRepository } from "@mnemonics/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import type { AiService } from "@mnemonics/ai";
import { autoLinkSimilarItems } from "../auto-link-similar.js";

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

      // 3. Save embedding to database
      await this.saveEmbedding(
        job.itemId,
        job.userId,
        embedding,
        providerInfo.model
      );

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
    }

    console.log(`[EmbedHandler] Item ${job.itemId} is now ready`);
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
    model: string
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
            updated_at: new Date().toISOString(),
          },
          { onConflict: "item_id" }
        );

      if (error) {
        throw new Error(`Failed to save embedding: ${error.message}`);
      }
    } else {
      await this.repository.saveEmbedding(itemId, userId, embedding, model);
    }
  }
}