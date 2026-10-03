/**
 * Tag Job Handler
 *
 * Generates auto-tags for items using the injected AiService text
 * provider. Order:
 *   1. `ai.text.generateTags()` (Gemini by default, heuristic if
 *      no Gemini key) — provider-agnostic.
 *   2. Fallback to local keyword heuristic if no provider is wired
 *      up so a brand-new install without any keys still tags
 *      memories (top-5 most frequent non-stop-word tokens).
 *
 * After a successful tag pass, an embed job is enqueued so the
 * capture pipeline stays sequential (tag → embed) and the item
 * moves to `ready` only when both finish.
 */

import type { JobQueue } from "../queue.js";
import type { ItemRepository } from "@mnemonics/database";
import type { AiService } from "@mnemonics/ai";

export interface TagHandlerDeps {
  queue: JobQueue;
  repository: ItemRepository;
  ai: AiService;
}

export class TagHandler {
  private queue: JobQueue;
  private repository: ItemRepository;
  private ai: AiService;

  constructor(deps: TagHandlerDeps) {
    this.queue = deps.queue;
    this.repository = deps.repository;
    this.ai = deps.ai;
  }

  async handle(job: { id: string; itemId: string; userId: string; payload: Record<string, unknown> }): Promise<void> {
    console.log(`[TagHandler] Processing tag job ${job.id} for item ${job.itemId}`);

    try {
      const item = await this.repository.findById(job.itemId);
      if (!item) {
        throw new Error("Item not found");
      }

      await this.repository.updateStatus(job.itemId, "processing");

      const tags = await this.generateTags(item);
      await this.repository.updateTags(job.itemId, tags);

      await this.queue.markCompleted(job.id);

      await this.queue.create({
        type: "embed",
        itemId: job.itemId,
        userId: job.userId,
        payload: { afterTag: true },
      });

      console.log(`[TagHandler] Tags generated for item ${job.itemId}:`, tags);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[TagHandler] Error processing job ${job.id}:`, errorMessage);
      throw new Error(errorMessage);
    }
  }

  private async generateTags(item: {
    id: string;
    type: string;
    title: string;
    rawText?: string | null;
    ocrText?: string | null;
  }): Promise<string[]> {
    const textToTag = [
      item.title,
      item.ocrText || "",
      item.rawText || "",
    ]
      .filter(Boolean)
      .join(" ");

    if (!textToTag.trim()) {
      return [];
    }

    const info = this.ai.text.info();
    if (info.name !== "noop") {
      try {
        const tags = await this.ai.text.generateTags(textToTag);
        if (tags.length > 0) return tags;
      } catch (error) {
        console.warn("[TagHandler] text provider tagging failed, falling back to heuristic:", error);
      }
    }

    return this.extractKeywordsHeuristic(textToTag);
  }

  private extractKeywordsHeuristic(text: string): string[] {
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "must", "shall", "can", "this",
      "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
      "what", "which", "who", "whom", "whose", "where", "when", "why", "how"
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 3 &&
          word.length <= 32 &&
          !stopWords.has(word) &&
          !/^\d+$/.test(word)
      );

    const frequency: Record<string, number> = {};
    for (const word of words) {
      frequency[word] = (frequency[word] || 0) + 1;
    }

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
}