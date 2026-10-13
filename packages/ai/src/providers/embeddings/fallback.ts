/**
 * Embedding provider that tries a primary provider and, on
 * ProviderError, retries once with a fallback. Mirrors the text
 * wrapper's contract exactly so the same reasoning applies.
 *
 * For embeddings the fallback chain terminates at noop, so a Gemini
 * outage degrades to lexical-only search rather than to a
 * mis-dimensioned silent failure. The chain always terminates
 * honestly: the noop throws — so a caller can never mistake
 * "no embedding" for "semantically unrelated".
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
