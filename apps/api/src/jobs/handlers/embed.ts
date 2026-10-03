/**
 * Embed Job Handler
 *
 * Processes embedding jobs for all item types.
 * Generates vector embeddings via the injected AiService (which is
 * the single source of truth for provider selection — Gemini by
 * default, OpenAI as legacy fallback, noop when free-only is on
 * without a Gemini key).
 *
 * M1 fix: previously this handler called OpenAI directly via a
 * `fetch('https://api.openai.com/v1/embeddings')` URL. That broke
 * the FREE-ONLY-only deployment because no OpenAI key is set. Now
 * the handler delegates to `ai.embeddings.embed()` so the provider
 * picked by `loadAiConfig()` (Gemini when `GEMINI_API_KEY` is set,
 * OpenAI legacy when explicitly chosen, else NoopEmbedding) wins.
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

      // 2. Generate embedding
      const textToEmbed = this.prepareTextForEmbedding(item);
      if (!textToEmbed.trim()) {
        console.log(`[EmbedHandler] No text to embed for item ${job.itemId}`);
        await this.queue.markCompleted(job.id);
        return;
      }

      const providerInfo = this.ai.embeddings.info();
      let embedding: number[];
      if (providerInfo.name === "noop") {
        // No provider available — store a deterministic mock so the
        // search table stays consistent. Same shape as the old
        // OpenAI keyless fallback.
        console.warn(
          `[EmbedHandler] No embedding provider configured (name=${providerInfo.name}), storing mock embedding`
        );
        embedding = this.generateMockEmbedding(textToEmbed.length);
      } else {
        embedding = await this.ai.embeddings.embedOne(textToEmbed);
      }

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
      const allDone = await this.queue.areAllJobsCompleted(job.itemId);
      if (allDone) {
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
      } else {
        console.log(`[EmbedHandler] Item ${job.itemId} still has pending jobs`);
      }

      console.log(`[EmbedHandler] Embedding completed for item ${job.itemId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[EmbedHandler] Error processing job ${job.id}:`, errorMessage);
      throw new Error(errorMessage);
    }
  }

  private prepareTextForEmbedding(item: {
    id: string;
    type: string;
    title: string;
    rawText?: string | null;
    ocrText?: string | null;
  }): string {
    // Combine available text fields for embedding
    const parts = [
      item.title,
      item.rawText || "",
      item.ocrText || "",
    ].filter(Boolean);

    // Join with separators and truncate to ~8000 chars (leaving room for model limits)
    return parts.join("\n\n").slice(0, 8000);
  }

  private generateMockEmbedding(size: number): number[] {
    // Generate a deterministic mock embedding based on text length.
    // This is NOT a real embedding — search/cluster quality will be
    // bad. Only used when no embedding provider is configured.
    const dimensions = 1536;
    const embedding: number[] = [];

    for (let i = 0; i < dimensions; i++) {
      embedding.push(Math.sin(size + i * 0.1) * 0.5);
    }

    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
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