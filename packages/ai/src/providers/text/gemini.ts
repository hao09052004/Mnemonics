/**
 * Gemini text generation provider.
 *
 * Uses the public Gemini Developer API REST endpoint
 * `generativelanguage.googleapis.com`. Free tier, no SDK dependency.
 *
 * Failure policy:
 * - 4xx with INVALID_API_KEY → throw, do not retry
 * - 429 → respect Retry-After when present, exponential backoff with
 *   jitter otherwise. 3 attempts total, then throw.
 * - 5xx / network / timeout → exponential backoff with jitter, 3
 *   attempts total, then throw.
 *
 * Free-tier limits (per the Google AI Studio docs, current as of
 * the date in this file's history): 15 RPM, 1M TPM, 1500 RPD for
 * gemini-2.5-flash. The provider does NOT enforce these server-side;
 * the caller's retry policy + the soft daily-limit on the OCR
 * provider are the only back-pressure we add.
 */

import { ProviderError, truncate } from "../../types.js";
import type {
  TextProvider,
  TextProviderInfo,
  TextGenerationOptions,
} from "./types.js";
import { extractKeywordsHeuristic } from "./heuristic.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 20_000;

interface RetryOpts {
  timeoutMs: number;
  signal?: AbortSignal;
}

function backoffMs(attempt: number): number {
  // 500 / 1500 / 4000 with ±20% jitter
  const base = [500, 1500, 4000][attempt] ?? 4000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

interface GeminiCallArgs {
  apiKey: string;
  model: string;
  prompt: string;
  opts: RetryOpts;
  /** Total attempts including the first. */
  maxAttempts?: number;
}

async function callGemini({
  apiKey,
  model,
  prompt,
  opts,
  maxAttempts = 3,
}: GeminiCallArgs): Promise<string> {
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let lastErr: ProviderError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return text;
      }
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError({
          message: `Gemini auth failed (${res.status}): ${body.slice(0, 200)}`,
          code: "INVALID_API_KEY",
          provider: "gemini",
          retryable: false,
        });
      }
      if (res.status === 429) {
        const retryAfter = Number.parseFloat(res.headers.get("Retry-After") ?? "");
        const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : backoffMs(attempt);
        lastErr = new ProviderError({
          message: `Gemini rate-limited (429): ${body.slice(0, 200)}`,
          code: "RATE_LIMITED",
          provider: "gemini",
          retryable: true,
          retryAfterMs: wait,
        });
      } else if (res.status === 400) {
        throw new ProviderError({
          message: `Gemini bad request (400): ${body.slice(0, 200)}`,
          code: "INVALID_RESPONSE",
          provider: "gemini",
          retryable: false,
        });
      } else if (res.status >= 500) {
        lastErr = new ProviderError({
          message: `Gemini server error (${res.status}): ${body.slice(0, 200)}`,
          code: "PROVIDER_UNAVAILABLE",
          provider: "gemini",
          retryable: true,
        });
      } else {
        throw new ProviderError({
          message: `Gemini unexpected (${res.status}): ${body.slice(0, 200)}`,
          code: "INVALID_RESPONSE",
          provider: "gemini",
          retryable: false,
        });
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ProviderError && !err.retryable) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        lastErr = new ProviderError({
          message: "Gemini timeout",
          code: "TIMEOUT",
          provider: "gemini",
          retryable: true,
        });
      } else if (err instanceof ProviderError) {
        lastErr = err;
      } else {
        lastErr = new ProviderError({
          message: err instanceof Error ? err.message : String(err),
          code: "UNKNOWN",
          provider: "gemini",
          retryable: true,
        });
      }
    }
    if (attempt < maxAttempts - 1) {
      const wait = lastErr?.retryAfterMs ?? backoffMs(attempt);
      await sleep(wait, opts.signal);
    }
  }
  throw (
    lastErr ??
    new ProviderError({
      message: "Gemini call failed after retries",
      code: "UNKNOWN",
      provider: "gemini",
      retryable: false,
    })
  );
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
    private readonly model: string
  ) {
    if (!apiKey) {
      throw new Error("GeminiTextProvider: apiKey is required");
    }
  }

  async generateTags(content: string, opts?: TextGenerationOptions): Promise<string[]> {
    if (!content || !content.trim()) return [];
    const prompt = `${TAGS_PROMPT}${truncate(content, 6000)}"""`;
    try {
      const raw = await callGemini({
        apiKey: this.apiKey,
        model: this.model,
        prompt,
        opts: { timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS },
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
      const raw = await callGemini({
        apiKey: this.apiKey,
        model: this.model,
        prompt,
        opts: { timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS },
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
