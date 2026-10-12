/**
 * Gemini text generation provider.
 *
 * Uses the public Gemini Developer API REST endpoint
 * `generativelanguage.googleapis.com`. Free tier, no SDK dependency.
 *
 * All HTTP work goes through the shared {@link GeminiClient} which
 * owns timeout, retry, rate-limit, concurrency, and circuit-breaker
 * behaviour. This file is therefore small: it constructs the right
 * request body, parses the response, and surfaces it as a TextProvider.
 *
 * Free-tier limits (per the Google AI Studio docs, current as of
 * the date in this file's history): 15 RPM, 1M TPM, 1500 RPD for
 * gemini-2.5-flash. The shared client is the only place that
 * enforces the RPM cap; the per-call timeout, max retries, and
 * per-process concurrency come from GEMINI_REQUEST_TIMEOUT_MS /
 * GEMINI_MAX_RETRIES / GEMINI_MAX_CONCURRENT_REQUESTS env vars
 * (see {@link buildGeminiClient}).
 */

import { ProviderError, truncate } from "../../types.js";
import { GeminiClient, type GeminiTask } from "../../gemini-client.js";
import type {
  TextProvider,
  TextProviderInfo,
  TextGenerationOptions,
} from "./types.js";
import { extractKeywordsHeuristic } from "./heuristic.js";

interface GeminiCallArgs {
  client: GeminiClient;
  apiKey: string;
  model: string;
  prompt: string;
  /** Per-attempt timeout override. */
  timeoutMs?: number;
  /** Total wall-clock budget across all retries. */
  totalBudgetMs?: number;
}

async function callGeminiText({
  client,
  apiKey,
  model,
  prompt,
  timeoutMs,
  totalBudgetMs
}: GeminiCallArgs): Promise<string> {
  const res = await client.call<{
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  }>({
    apiKey,
    model,
    task: "text" satisfies GeminiTask,
    path: `models/${encodeURIComponent(model)}:generateContent`,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        // Gemini 3.x "thinking" models spend a large share of
        // the budget on internal reasoning (thoughtsTokenCount)
        // before emitting any visible output. A 256-token cap
        // finishes with MAX_TOKENS after the JSON opener and
        // returns unparseable text. 1024 leaves enough headroom
        // for thinking + a real JSON array of tags / sentence.
        maxOutputTokens: 1024
      }
    },
    totalBudgetMs
  });
  // Gemini 3.x thinking models sometimes return only an empty
  // parts array (the visible "text" field is missing because all
  // tokens went into reasoning). Surface MAX_TOKENS / blocked
  // prompts to the caller so it can decide whether to retry,
  // fall back, or fail open.
  const candidate = res.candidates?.[0];
  if (!candidate) {
    throw new ProviderError({
      message: `Gemini returned no candidates (blockReason=${
        res.promptFeedback?.blockReason ?? "unknown"
      })`,
      code: "INVALID_RESPONSE",
      provider: "gemini",
      retryable: false
    });
  }
  const text = candidate.content?.parts?.[0]?.text ?? "";
  if (!text && candidate.finishReason === "MAX_TOKENS") {
    throw new ProviderError({
      message:
        "Gemini hit MAX_TOKENS before producing visible output (maxOutputTokens too small?)",
      code: "INVALID_RESPONSE",
      provider: "gemini",
      retryable: true
    });
  }
  return text;
}

const TAGS_PROMPT = `You generate tags for a personal second-brain product.
Return ONLY a JSON array of up to 5 tags, lowercase, kebab-case, 3-32 chars each.
No commentary. No markdown.

Content:
"""";
`;
const SUMMARIZE_PROMPT = `Summarise the content in one short sentence (≤ 200 chars).
No preamble, no trailing punctuation. Return only the sentence.

Content:
"""";
`;

export class GeminiTextProvider implements TextProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly client: GeminiClient
  ) {
    if (!apiKey) {
      throw new Error("GeminiTextProvider: apiKey is required");
    }
  }

  async generateTags(content: string, opts?: TextGenerationOptions): Promise<string[]> {
    if (!content || !content.trim()) return [];
    const prompt = `${TAGS_PROMPT}${truncate(content, 6000)}"""`;
    try {
      const raw = await callGeminiText({
        client: this.client,
        apiKey: this.apiKey,
        model: this.model,
        prompt,
        totalBudgetMs: opts?.timeoutMs
      });
      const cleaned = raw
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      let parsed: unknown = [];
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((t) =>
          String(t)
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "")
            .slice(0, 32)
        )
        .filter((t) => t.length >= 3);
    } catch (err) {
      if (opts?.failOpen) {
        return extractKeywordsHeuristic(content, 5);
      }
      throw err;
    }
  }

  async summarize(content: string, opts?: TextGenerationOptions): Promise<string> {
    if (!content || !content.trim()) return "";
    const prompt = `${SUMMARIZE_PROMPT}${truncate(content, 4000)}"""`;
    try {
      const raw = await callGeminiText({
        client: this.client,
        apiKey: this.apiKey,
        model: this.model,
        prompt,
        totalBudgetMs: opts?.timeoutMs
      });
      return raw.trim().slice(0, 200);
    } catch (err) {
      if (opts?.failOpen) return "";
      throw err;
    }
  }

  info(): TextProviderInfo {
    return { name: "gemini", model: this.model };
  }
}
