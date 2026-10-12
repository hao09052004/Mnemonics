/**
 * Deterministic, zero-cost tag generator used as the always-on
 * fallback. It is also the provider selected when AI_TEXT_PROVIDER=heuristic
 * and the only safe provider in AI_FREE_ONLY=true + no Gemini key.
 *
 * The algorithm: tokenize on word boundaries, drop stopwords, count
 * frequency, return the top N. This is intentionally boring.
 */

import type { TextProvider, TextProviderInfo, TextGenerationOptions } from "./types.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "must", "shall", "can", "this",
  "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
  "what", "which", "who", "whom", "whose", "where", "when", "why", "how",
  "your", "our", "their", "my", "his", "her", "its", "than", "then",
]);

export function extractKeywordsHeuristic(text: string, max = 5): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        w.length <= 32 &&
        !STOPWORDS.has(w) &&
        !/^\d+$/.test(w)
    );
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

export class HeuristicTextProvider implements TextProvider {
  private readonly model = "deterministic-keyword-v1";

  async generateTags(content: string, _opts?: TextGenerationOptions): Promise<string[]> {
    return extractKeywordsHeuristic(content, 5);
  }

  async summarize(_content: string, _opts?: TextGenerationOptions): Promise<string> {
    // No deterministic summary; callers should rely on the article
    // extraction pipeline for the first 280 chars as a stand-in.
    return "";
  }

  info(): TextProviderInfo {
    return { name: "heuristic", model: this.model };
  }
}
