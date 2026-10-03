/**
 * Embedding provider that tries a primary provider and, on
 * ProviderError, retries once with a fallback. Mirrors the text
 * wrapper's contract exactly so the same reasoning applies.
 *
 * Today the only allowed fallback is a NoopEmbeddingProvider: the
 * project's pgvector column is 1536-d, and no Ollama model we ship
 * by default produces 1536-d vectors. The fallback is therefore
 * "lexical-only search" — semantic search degrades gracefully.
 *
 * If a future 1536-d local model is wired in (e.g. an Ollama build
 * that does project embeddings to 1536), swap the noop out for that
 * concrete provider; this wrapper does not need to change.
 */

import { ProviderError } from "../../types.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingOptions,
} from "./types.js";

export class FallingBackEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly primary: EmbeddingProvider,
    private readonly fallback: EmbeddingProvider
  ) {}

  async embedOne(text: string, opts?: EmbeddingOptions): Promise<number[]> {
    try {
      return await this.primary.embedOne(text, opts);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      console.warn(
        `[ai/embed] primary provider '${this.primary.info().name}' failed (${err.code}: ${err.message.slice(0, 120)}); falling back to '${this.fallback.info().name}'`
      );
      return this.fallback.embedOne(text, opts);
    }
  }

  async embedMany(texts: string[], opts?: EmbeddingOptions): Promise<number[][]> {
    try {
      return await this.primary.embedMany(texts, opts);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      console.warn(
        `[ai/embed] primary provider '${this.primary.info().name}' failed (${err.code}: ${err.message.slice(0, 120)}); falling back to '${this.fallback.info().name}'`
      );
      return this.fallback.embedMany(texts, opts);
    }
  }

  info(): EmbeddingProviderInfo {
    return {
      name: `${this.primary.info().name}+${this.fallback.info().name}`,
      model: this.primary.info().model,
      // Always advertise the primary's dim — if the primary works,
      // that's what callers get. If the noop fallback runs, it
      // throws so the dimension here is informational only.
      dimensions: this.primary.info().dimensions,
    };
  }
}
