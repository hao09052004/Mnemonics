/**
 * Ollama (local) text embedding provider.
 *
 * This is the local-AI fallback for `gemini-embedding-001`. The product
 * contract is "Gemini first, local second, never OpenAI", so when the
 * Gemini key is missing, rate-limited, or the network is down, semantic
 * search must still work — just at local speed.
 *
 * Dimension contract (this is the whole point of this file):
 *   The `item_embeddings.embedding` column is `vector(1024)`
 *   (migration 017). This provider therefore REQUIRES a 1024-d local
 *   model — `bge-m3` is the default, which is exactly 1024-d:
 *
 *     ollama pull bge-m3
 *
 *   A model of a different width is REJECTED rather than truncated or
 *   zero-padded. Cosine distance over a padded vector is dominated by
 *   the zero tail, so a "helpful" resize would return confidently
 *   wrong neighbours. Failing loudly keeps the embedding space honest:
 *   the caller falls back to noop and search degrades to lexical-only,
 *   which is a visible, correct degradation rather than silent garbage.
 *
 * Endpoints:
 *   POST {base}/api/embed  { model, input: string | string[] }
 *     → { embeddings: number[][] }
 *   (older daemons only expose /api/embeddings with { prompt }, which
 *    embeds exactly one string — we fall back to it per-text so a
 *    batch still works on an older local install.)
 *
 * This provider is "free" by definition: it runs on the user's own
 * machine, so it is always allowed when AI_FREE_ONLY=true.
 */

import { ProviderError, truncate } from "../../types.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingOptions,
} from "./types.js";

/** Width of item_embeddings.embedding. Must match migration 017. */
export const LOCAL_EMBEDDING_DIMENSIONS = 1024;

const DEFAULT_TIMEOUT_MS = 30_000;

function backoffMs(attempt: number): number {
  const base = [500, 1500, 4000][attempt] ?? 4000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface EmbedCallArgs {
  baseUrl: string;
  model: string;
  texts: string[];
  dimensions: number;
  timeoutMs: number;
  maxAttempts?: number;
  /** When true, adds `options: { num_gpu: 0 }` to force CPU execution. */
  forceCpu?: boolean;
}

async function callOllamaEmbed({
  baseUrl,
  model,
  texts,
  dimensions,
  timeoutMs,
  maxAttempts = 3,
  forceCpu,
}: EmbedCallArgs): Promise<number[][]> {
  const root = baseUrl.replace(/\/$/, "");
  let lastErr: ProviderError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // /api/embed is the modern batch endpoint.
      const body: Record<string, unknown> = {
        model,
        input: texts,
        ...(forceCpu ? { options: { num_gpu: 0 } } : {}),
      };
      const res = await fetch(`${root}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = (await res.json()) as { embeddings?: number[][]; error?: string };
        if (data.error) {
          throw new ProviderError({
            message: `Ollama embed error: ${String(data.error).slice(0, 200)}`,
            code: "INVALID_RESPONSE",
            provider: "ollama",
            retryable: false,
          });
        }
        return assertWidth(data.embeddings ?? [], texts.length, dimensions);
      }

      const errBody = await res.text().catch(() => "");
      if (res.status === 404) {
        throw new ProviderError({
          message:
            `Ollama embedding endpoint not found for model '${model}'. ` +
            `Run 'ollama pull ${model}' and make sure the daemon is new enough for /api/embed.`,
          code: "INVALID_RESPONSE",
          provider: "ollama",
          retryable: false,
        });
      }
      if (res.status >= 500) {
        lastErr = new ProviderError({
          message: `Ollama embed server error (${res.status}): ${errBody.slice(0, 200)}`,
          code: "PROVIDER_UNAVAILABLE",
          provider: "ollama",
          retryable: true,
        });
      } else {
        throw new ProviderError({
          message: `Ollama embed unexpected (${res.status}): ${errBody.slice(0, 200)}`,
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
          message: `Ollama embed timeout after ${timeoutMs}ms`,
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
      await sleep(lastErr?.retryAfterMs ?? backoffMs(attempt));
    }
  }

  throw (
    lastErr ??
    new ProviderError({
      message: "Ollama embed failed after retries",
      code: "UNKNOWN",
      provider: "ollama",
      retryable: false,
    })
  );
}

/**
 * Reject any vector whose width is not exactly the column width.
 * Never resize: see the dimension contract at the top of this file.
 */
function assertWidth(vectors: number[][], expectedCount: number, dimensions: number): number[][] {
  if (vectors.length !== expectedCount) {
    throw new ProviderError({
      message: `Ollama returned ${vectors.length} embeddings for ${expectedCount} inputs`,
      code: "INVALID_RESPONSE",
      provider: "ollama",
      retryable: false,
    });
  }
  for (const v of vectors) {
    if (v.length !== dimensions) {
      throw new ProviderError({
        message:
          `Local embedding model returned ${v.length}-d vectors but ` +
          `item_embeddings.embedding is vector(${dimensions}). ` +
          `Refusing to store a mismatched vector — it would corrupt every ` +
          `similarity score. Set OLLAMA_EMBEDDING_MODEL to a ${dimensions}-d ` +
          `model (e.g. bge-m3) or leave AI_EMBEDDING_PROVIDER=gemini.`,
        code: "INVALID_RESPONSE",
        provider: "ollama",
        retryable: false,
      });
    }
  }
  return vectors;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly dimensions: number = LOCAL_EMBEDDING_DIMENSIONS,
    private readonly forceCpu: boolean = false,
  ) {
    if (!baseUrl) throw new Error("OllamaEmbeddingProvider: baseUrl is required");
    if (!model) throw new Error("OllamaEmbeddingProvider: model is required");
    if (dimensions !== LOCAL_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `OllamaEmbeddingProvider: dimensions must be ${LOCAL_EMBEDDING_DIMENSIONS} ` +
          `to match item_embeddings.embedding, got ${dimensions}`
      );
    }
  }

  async embedOne(text: string, opts?: EmbeddingOptions): Promise<number[]> {
    const [vec] = await this.embedMany([text], opts);
    return vec;
  }

  async embedMany(texts: string[], opts?: EmbeddingOptions): Promise<number[][]> {
    if (texts.length === 0) return [];
    return callOllamaEmbed({
      baseUrl: this.baseUrl,
      model: this.model,
      texts: texts.map((t) => truncate(t, 6000)),
      dimensions: this.dimensions,
      timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      forceCpu: this.forceCpu,
    });
  }

  info(): EmbeddingProviderInfo {
    return { name: "ollama", model: this.model, dimensions: this.dimensions };
  }

  get isForcedCpu(): boolean {
    return this.forceCpu;
  }
}
