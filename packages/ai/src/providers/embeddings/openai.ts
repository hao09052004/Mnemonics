/**
 * OpenAI embedding provider.
 *
 * Legacy / optional. Selected only when AI_FREE_ONLY=false AND
 * AI_EMBEDDING_PROVIDER=openai. The ai-config module refuses to
 * construct an OpenAI provider when AI_FREE_ONLY=true.
 */

import { ProviderError, truncate } from "../../types.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingOptions,
} from "./types.js";

const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";

function backoffMs(attempt: number): number {
  const base = [500, 1500, 4000][attempt] ?? 4000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface CallArgs {
  apiKey: string;
  model: string;
  texts: string[];
  timeoutMs: number;
  maxAttempts?: number;
}

async function callOpenAI({
  apiKey,
  model,
  texts,
  timeoutMs,
  maxAttempts = 3,
}: CallArgs): Promise<number[][]> {
  let lastErr: ProviderError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(OPENAI_EMBED_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts.map((t) => truncate(t, 8000)) }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          data?: Array<{ embedding?: number[] }>;
        };
        const vecs = (data.data ?? []).map((d) => d.embedding ?? []);
        if (vecs.length !== texts.length) {
          throw new ProviderError({
            message: `OpenAI returned ${vecs.length} embeddings for ${texts.length} inputs`,
            code: "INVALID_RESPONSE",
            provider: "openai",
            retryable: false,
          });
        }
        return vecs;
      }
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new ProviderError({
          message: `OpenAI auth failed: ${body.slice(0, 200)}`,
          code: "INVALID_API_KEY",
          provider: "openai",
          retryable: false,
        });
      }
      if (res.status === 429) {
        const retryAfter = Number.parseFloat(res.headers.get("Retry-After") ?? "");
        const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : backoffMs(attempt);
        lastErr = new ProviderError({
          message: "OpenAI rate-limited",
          code: "RATE_LIMITED",
          provider: "openai",
          retryable: true,
          retryAfterMs: wait,
        });
      } else if (res.status >= 500) {
        lastErr = new ProviderError({
          message: `OpenAI server error (${res.status})`,
          code: "PROVIDER_UNAVAILABLE",
          provider: "openai",
          retryable: true,
        });
      } else {
        throw new ProviderError({
          message: `OpenAI unexpected (${res.status}): ${body.slice(0, 200)}`,
          code: "INVALID_RESPONSE",
          provider: "openai",
          retryable: false,
        });
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ProviderError && !err.retryable) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        lastErr = new ProviderError({
          message: "OpenAI timeout",
          code: "TIMEOUT",
          provider: "openai",
          retryable: true,
        });
      } else if (err instanceof ProviderError) {
        lastErr = err;
      } else {
        lastErr = new ProviderError({
          message: err instanceof Error ? err.message : String(err),
          code: "UNKNOWN",
          provider: "openai",
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
      message: "OpenAI embedding failed after retries",
      code: "UNKNOWN",
      provider: "openai",
      retryable: false,
    })
  );
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number
  ) {
    if (!apiKey) throw new Error("OpenAIEmbeddingProvider: apiKey is required");
  }

  async embedOne(text: string, opts?: EmbeddingOptions): Promise<number[]> {
    const [vec] = await this.embedMany([text], opts);
    return vec;
  }

  async embedMany(texts: string[], opts?: EmbeddingOptions): Promise<number[][]> {
    if (texts.length === 0) return [];
    return callOpenAI({
      apiKey: this.apiKey,
      model: this.model,
      texts,
      timeoutMs: opts?.timeoutMs ?? 20_000,
    });
  }

  info(): EmbeddingProviderInfo {
    return { name: "openai", model: this.model, dimensions: this.dimensions };
  }
}
