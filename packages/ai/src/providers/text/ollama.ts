/**
 * Ollama text generation provider.
 *
 * Talks to a locally-running Ollama daemon (https://ollama.com) over
 * its HTTP API. The Mnemonics deployment contract:
 *
 *   - base URL: OLLAMA_BASE_URL, defaults to http://localhost:11434
 *   - text model: OLLAMA_TEXT_MODEL, defaults to llama3.2:3b
 *
 * Two endpoints are used:
 *
 *   POST {base}/api/generate
 *     { model, prompt, stream: false, format: "json", options }
 *     → { response: "<text>" }
 *   POST {base}/api/chat
 *     { model, messages: [...], stream: false, format: "json" }
 *     → { message: { content: "<text>" } }
 *
 * We use /api/generate for one-shot prompts (tag generation, summary)
 * because the same model is then reusable for /api/embed. We also
 * probe /api/tags once at construction so a misconfigured base URL
 * surfaces immediately, not on the first capture.
 *
 * This provider is "free" by definition: it runs on the user's own
 * machine. It is therefore always allowed when AI_FREE_ONLY=true.
 *
 * Failure policy (matches Gemini):
 *   - network / timeout / 5xx   → retry with backoff, 3 attempts
 *   - 4xx                      → throw INVALID_RESPONSE
 *   - non-JSON / empty response → throw INVALID_RESPONSE
 */

import { ProviderError, truncate } from "../../types.js";
import type {
  TextProvider,
  TextProviderInfo,
  TextGenerationOptions,
} from "./types.js";
import { extractKeywordsHeuristic } from "./heuristic.js";

const DEFAULT_TIMEOUT_MS = 30_000;
// Small models on CPU can take a while to warm up. 30s is a safe cap
// for a single generate call; retries use the same budget.
const PROBE_TIMEOUT_MS = 3_000;

function backoffMs(attempt: number): number {
  // 500 / 1500 / 4000 with ±20% jitter, same shape as the Gemini
  // provider so the caller's overall latency budget is predictable.
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

interface OllamaCallArgs {
  baseUrl: string;
  model: string;
  prompt: string;
  json: boolean;
  opts: { timeoutMs: number; signal?: AbortSignal };
  maxAttempts?: number;
  /** When true, adds `options: { num_gpu: 0 }` to force CPU execution. */
  forceCpu?: boolean;
}

async function callOllama({
  baseUrl,
  model,
  prompt,
  json,
  opts,
  maxAttempts = 3,
  forceCpu,
}: OllamaCallArgs): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/generate`;
  const body = JSON.stringify({
    model,
    prompt,
    stream: false,
    // `format: "json"` tells Ollama to constrain the response to
    // a JSON value. We still tolerate markdown fences (some small
    // models ignore the constraint) by stripping ```json/```.
    ...(json ? { format: "json" } : {}),
    options: {
      temperature: 0.3,
      // Generous num_predict cap: small open models can ramble.
      // The post-processing step trims to <=32 chars and 5 tags.
      num_predict: 512,
      ...(forceCpu ? { num_gpu: 0 } : {}),
    },
  });
  let lastErr: ProviderError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          response?: string;
          done_reason?: string;
          error?: string;
        };
        if (data.error) {
          throw new ProviderError({
            message: `Ollama returned error: ${data.error.slice(0, 200)}`,
            code: "INVALID_RESPONSE",
            provider: "ollama",
            retryable: false,
          });
        }
        return data.response ?? "";
      }
      const errBody = await res.text().catch(() => "");
      if (res.status === 404) {
        throw new ProviderError({
          message: `Ollama model '${model}' not found (404). Run 'ollama pull ${model}' first.`,
          code: "INVALID_RESPONSE",
          provider: "ollama",
          retryable: false,
        });
      }
      if (res.status >= 500) {
        lastErr = new ProviderError({
          message: `Ollama server error (${res.status}): ${errBody.slice(0, 200)}`,
          code: "PROVIDER_UNAVAILABLE",
          provider: "ollama",
          retryable: true,
        });
      } else {
        throw new ProviderError({
          message: `Ollama unexpected (${res.status}): ${errBody.slice(0, 200)}`,
          code: "INVALID_RESPONSE",
          provider: "ollama",
          retryable: false,
        });
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ProviderError && !err.retryable) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        lastErr = new ProviderError({
          message: `Ollama timeout after ${opts.timeoutMs}ms`,
          code: "TIMEOUT",
          provider: "ollama",
          retryable: true,
        });
      } else if (err instanceof ProviderError) {
        lastErr = err;
      } else {
        lastErr = new ProviderError({
          message: err instanceof Error ? err.message : String(err),
          code: "PROVIDER_UNAVAILABLE",
          provider: "ollama",
          retryable: true,
        });
      }
    }
    if (attempt < maxAttempts - 1) {
      await sleep(lastErr?.retryAfterMs ?? backoffMs(attempt), opts.signal);
    }
  }
  throw (
    lastErr ??
    new ProviderError({
      message: "Ollama call failed after retries",
      code: "UNKNOWN",
      provider: "ollama",
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

export class OllamaTextProvider implements TextProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly forceCpu: boolean = false,
  ) {
    if (!baseUrl) {
      throw new Error("OllamaTextProvider: baseUrl is required");
    }
    if (!model) {
      throw new Error("OllamaTextProvider: model is required");
    }
  }

  /**
   * Probe the Ollama daemon. Best-effort: a failed probe does NOT
   * throw (the provider is a fallback; the caller can decide whether
   * to attempt a capture anyway), but it does log.
   */
  async probe(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const have = (data.models ?? []).some((m) => m.name === this.model);
      if (!have) {
        console.warn(
          `[ai/text] Ollama is up at ${this.baseUrl} but model '${this.model}' is not pulled. ` +
            `Run 'ollama pull ${this.model}' to enable local fallback.`
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  async generateTags(content: string, opts?: TextGenerationOptions): Promise<string[]> {
    if (!content || !content.trim()) return [];
    const prompt = `${TAGS_PROMPT}${truncate(content, 6000)}"""`;
    try {
      const raw = await callOllama({
        baseUrl: this.baseUrl,
        model: this.model,
        prompt,
        json: true,
        opts: { timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS },
        forceCpu: this.forceCpu,
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
      const raw = await callOllama({
        baseUrl: this.baseUrl,
        model: this.model,
        prompt,
        json: false,
        opts: { timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS },
        forceCpu: this.forceCpu,
      });
      return raw.trim().slice(0, 200);
    } catch (err) {
      if (opts?.failOpen) return "";
      throw err;
    }
  }

  info(): TextProviderInfo {
    return { name: "ollama", model: this.model };
  }
}
