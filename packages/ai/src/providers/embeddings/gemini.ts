/**
 * Gemini text embedding provider.
 *
 * Uses `models/gemini-embedding-001` with `outputDimensionality=1024`
 * so the result is compatible with the `item_embeddings`
 * pgvector column (vector(1024) — migration 017).
 *
 * All HTTP work goes through the shared {@link GeminiClient}; see
 * `gemini-client.ts` for the timeout / retry / rate-limit /
 * circuit-breaker policy. The text model and the embedding model
 * are NEVER the same model id (`gemini-embedding-001` vs.
 * `gemini-3.8-flash`) and the dimensions they emit are unrelated;
 * do not compare vectors across the two without re-embedding.
 *
 * Free tier limits (gemini-embedding-001): 1500 RPD, 15 RPM. No
 * server-side enforcement here.
 */

import { ProviderError, truncate } from "../../types.js";
import { GeminiClient, type GeminiTask } from "../../gemini-client.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingOptions,
} from "./types.js";

interface BatchArgs {
  client: GeminiClient;
  apiKey: string;
  model: string;
  texts: string[];
  dimensions: number;
  totalBudgetMs?: number;
}

async function callBatch({
  client,
  apiKey,
  model,
  texts,
  dimensions,
  totalBudgetMs
}: BatchArgs): Promise<number[][]> {
  const data = await client.call<{
    embeddings?: Array<{ values?: number[] }>;
  }>({
    apiKey,
    model,
    task: "embedding" satisfies GeminiTask,
    path: `models/${encodeURIComponent(model)}:batchEmbedContents`,
    body: {
      requests: texts.map((t) => ({
        model: `models/${model}`,
        content: { parts: [{ text: t }] },
        outputDimensionality: dimensions
      }))
    },
    totalBudgetMs
  });
  const vecs = (data.embeddings ?? []).map((e) => e.values ?? []);
  if (vecs.length !== texts.length) {
    throw new ProviderError({
      message: `Gemini returned ${vecs.length} embeddings for ${texts.length} inputs`,
      code: "INVALID_RESPONSE",
      provider: "gemini",
      retryable: false
    });
  }
  return vecs;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly client: GeminiClient
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
      client: this.client,
      apiKey: this.apiKey,
      model: this.model,
      texts: texts.map((t) => truncate(t, 6000)),
      dimensions: this.dimensions,
      totalBudgetMs: opts?.timeoutMs
    });
  }

  info(): EmbeddingProviderInfo {
    return { name: "gemini", model: this.model, dimensions: this.dimensions };
  }
}
