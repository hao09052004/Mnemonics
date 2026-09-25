/**
 * Embed Job Handler
 *
 * Processes embedding jobs for all item types.
 * Generates vector embeddings using OpenAI's embedding models.
 */

import type { JobQueue } from '../queue.js';
import type { ItemRepository } from '@mnemonics/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { autoLinkSimilarItems } from '../auto-link-similar.js';

export class EmbedHandler {
  private queue: JobQueue;
  private repository: ItemRepository;
  private supabase?: SupabaseClient;
  private openAiKey?: string;
  private pool?: Pool;

  constructor(
    queue: JobQueue,
    repository: ItemRepository,
    supabase?: SupabaseClient,
    openAiKey?: string,
    pool?: Pool
  ) {
    this.queue = queue;
    this.repository = repository;
    this.supabase = supabase;
    this.openAiKey = openAiKey;
    this.pool = pool;
  }

  async handle(job: { id: string; itemId: string; userId: string; payload: Record<string, unknown> }): Promise<void> {
    console.log(`[EmbedHandler] Processing embed job ${job.id} for item ${job.itemId}`);

    try {
      // 1. Get the item
      const item = await this.repository.findById(job.itemId);
      if (!item) {
        throw new Error('Item not found');
      }

      // 2. Generate embedding
      const textToEmbed = this.prepareTextForEmbedding(item);
      if (!textToEmbed.trim()) {
        console.log(`[EmbedHandler] No text to embed for item ${job.itemId}`);
        await this.queue.markCompleted(job.id);
        return;
      }

      const embedding = await this.generateEmbedding(textToEmbed);

      // 3. Save embedding to database
      await this.saveEmbedding(job.itemId, job.userId, embedding);

      // 4. Mark job as completed
      await this.queue.markCompleted(job.id);

      // 5. Check if all jobs are done, then mark item as ready
      const allDone = await this.queue.areAllJobsCompleted(job.itemId);
      if (allDone) {
        await this.repository.updateStatus(job.itemId, 'ready');

        if (this.openAiKey && this.pool) {
          const related = await autoLinkSimilarItems(this.pool, job.userId, job.itemId);
          console.log(
            `[EmbedHandler] Auto-linked ${related.length} similar memories for item ${job.itemId}`
          );
        }

        console.log(`[EmbedHandler] Item ${job.itemId} is now ready`);
      } else {
        console.log(`[EmbedHandler] Item ${job.itemId} still has pending jobs`);
      }

      console.log(`[EmbedHandler] Embedding completed for item ${job.itemId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
      item.rawText || '',
      item.ocrText || ''
    ].filter(Boolean);

    // Join with separators and truncate to ~8000 chars (leaving room for model limits)
    return parts.join('\n\n').slice(0, 8000);
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openAiKey) {
      // Fallback: generate a mock embedding for development
      // In production, this should throw an error
      console.warn('[EmbedHandler] No OpenAI key, generating mock embedding');
      return this.generateMockEmbedding(text.length);
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openAiKey}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding || [];
  }

  private generateMockEmbedding(size: number): number[] {
    // Generate a deterministic mock embedding based on text length
    // This is NOT for production - just for development
    const dimensions = 1536;
    const embedding: number[] = [];

    for (let i = 0; i < dimensions; i++) {
      // Simple hash-like pattern
      embedding.push(Math.sin(size + i * 0.1) * 0.5);
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  }

  private async saveEmbedding(itemId: string, userId: string, embedding: number[]): Promise<void> {
    // Store embedding in item_embeddings table
    // This uses the repository pattern
    if (this.supabase) {
      const { error } = await this.supabase
        .from('item_embeddings')
        .upsert({
          item_id: itemId,
          model: 'text-embedding-3-small',
          dimensions: embedding.length,
          embedding: embedding,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'item_id'
        });

      if (error) {
        throw new Error(`Failed to save embedding: ${error.message}`);
      }
    } else {
      // Direct database insert via repository
      await this.repository.saveEmbedding(itemId, userId, embedding, 'text-embedding-3-small');
    }
  }
}
