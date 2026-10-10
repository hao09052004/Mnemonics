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

      // User-supplied tags (added via PATCH /items/:id before the
      // tag job ran) must be preserved. Auto-tagging is only an
      // enrichment on top of an empty tag set — overriding
      // hand-picked tags is destructive and surprising.
      const existingTags = await this.repository.getTagsForItem(job.itemId);
      const tags = existingTags.length > 0 ? existingTags : await this.generateTags(item);
      if (existingTags.length === 0) {
        await this.repository.updateTags(job.itemId, tags);
      } else {
        console.log(
          `[TagHandler] Skipping auto-tag for item ${job.itemId} (user supplied ${existingTags.length} tag(s))`
        );
      }

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
    userId?: string;
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

    // Per-user AI quota: charge the user before invoking the
    // primary text provider. If the user is at the daily cap, the
    // quota throws and we fall through to the deterministic
    // heuristic — the memory is preserved and the pipeline can
    // still complete.
    try {
      const info = this.ai.text.info();
      if (info.name !== "noop") {
        const tagsJson = await this.ai.tagsForUser(item.userId ?? null, textToTag, {
          task: "tag"
        });
        const parsed = parseTagsFromText(tagsJson);
        if (parsed.length > 0) return parsed;
      }
    } catch (error) {
      // Quota RATE_LIMITED or other provider error — fall through
      // to the heuristic. The handler still completes.
      console.warn("[TagHandler] text provider tagging failed, falling back to heuristic:", error);
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

/**
 * Parse a Gemini text-tag response into a clean tag array.
 *
 * The provider is asked for a JSON array of tags; sometimes it
 * wraps the array in a code fence, adds prose around it, or
 * returns a comma-separated list when JSON mode is off. We accept
 * all three shapes and return a kebab-cased, deduped, ≤ 5-tag list.
 */
function parseTagsFromText(raw: string): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  // 1) Direct JSON array.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return normalizeTags(parsed);
  } catch {
    // not JSON — fall through
  }
  // 2) Code-fenced JSON (```json [...] ``` or ```[...]```)
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      // fall through
    }
  }
  // 3) Embedded JSON array inside prose
  const embedded = trimmed.match(/\[[^\[\]]*\]/);
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded[0]);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      // fall through
    }
  }
  // 4) Comma- or newline-separated list as a last resort
  const items = trimmed
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/^[-*]\s*/, "").replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  return normalizeTags(items);
}

function normalizeTags(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const t = raw
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 32);
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}