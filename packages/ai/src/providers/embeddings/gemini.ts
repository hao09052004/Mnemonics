/**
 * Gemini text embedding provider.
 *
 * Uses `models/gemini-embedding-001` with `outputDimensionality=1024`
 * so the result is compatible with the `item_embeddings`
 * pgvector column (vector(1024) — migration 017).
 *
 * Free tier limits (gemini-embedding-001): 1500 RPD, 15 RPM. No
 * server-side enforcement here.
 */

import { ProviderError, truncate } from "../../types.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingOptions,
} from "./types.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function backoffMs(attempt: number): number {
  const base = [500, 1500, 4000][attempt] ?? 4000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface BatchArgs {
  apiKey: string;
  model: string;
  texts: string[];
  dimensions: number;
  timeoutMs: number;
  maxAttempts?: number;
}

async function callBatch({
  apiKey,
  model,
  texts,
  dimensions,
  timeoutMs,
  maxAttempts = 3,
}: BatchArgs): Promise<number[][]> {
  const url = `${BASE}/${encodeURIComponent(model)}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
  let lastErr: ProviderError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: texts.map((t) => ({
            model: `models/${model}`,
            content: { parts: [{ text: t }] },
            outputDimensionality: dimensions,
          })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          embeddings?: Array<{ values?: number[] }>;
        };
        const vecs = (data.embeddings ?? []).map((e) => e.values ?? []);
        if (vecs.length !== texts.length) {
          throw new ProviderError({
            message: `Gemini returned ${vecs.length} embeddings for ${texts.length} inputs`,
            code: "INVALID_RESPONSE",
            provider: "gemini",
            retryable: false,
          });
        }
        return vecs;
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
          message: `Gemini rate-limited (429)`,
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
          message: `Gemini server error (${res.status})`,
          code: "PROVIDER_UNAVAILABLE",
          provider: "gemini",
          retryable: true,
        });
      } else {
        throw new ProviderError({
          message: `Gemini unexpected (${res.status})`,
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
          message: "Gemini embedding timeout",
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
      await sleep(lastErr?.retryAfterMs ?? backoffMs(attempt));
    }
  }
  throw (
    lastErr ??
    new ProviderError({
      message: "Gemini embedding failed after retries",
      code: "UNKNOWN",
      provider: "gemini",
      retryable: false,
    })
  );
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number
  ) {
    if (!apiKey) throw new Error("GeminiEmbeddingProvider: apiKey is required");
  }

  async embedOne(text: string, opts?: EmbeddingOptions): Promise<number[]> {
    const [vec] = await this.embedMany([text], opts);
    return vec;
  }

  async embedMany(texts: string[], opts?: EmbeddingOptions): Promise<number[][]> {
    if (texts.length === 0) return [];
    return callBatch({
      apiKey: this.apiKey,
      model: this.model,
      texts: texts.map((t) => truncate(t, 6000)),
      dimensions: this.dimensions,
      timeoutMs: opts?.timeoutMs ?? 20_000,
    });
  }

  info(): EmbeddingProviderInfo {
    return { name: "gemini", model: this.model, dimensions: this.dimensions };
  }
}
