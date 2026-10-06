/**
 * Text embedding provider interface.
 *
 * Embeddings are stored in `item_embeddings.embedding` (the
 * pgvector column, `vector(1024)` since migration 017). New providers
 * must support the configured dimension, OR the schema must be
 * migrated.
 *
 * Implementations must:
 * - return a vector of exactly `dimensions` length
 * - NEVER pad or truncate to fit the column: a zero-padded vector
 *   ranks on its zero tail and returns arbitrary neighbours
 * - use cosine-friendly L2-normalised vectors (callers may
 *   normalise on read; the existing pgvector migration uses cosine)
 * - never silently degrade to a smaller-dim mock in production
 *   (DEMO_MODE is the only place mocks are allowed; see noop.ts)
 */

import type { ProviderError } from "../../types.js";

export interface EmbeddingOptions {
  timeoutMs?: number;
  model?: string;
}

export interface EmbeddingProviderInfo {
  name: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingProvider {
  /**
   * Embed a single string. Throws ProviderError on failure.
   */
  embedOne(text: string, opts?: EmbeddingOptions): Promise<number[]>;

  /**
   * Embed a batch. Implementations should batch internally where the
   * upstream API supports it (Gemini batchEmbedContents, Ollama
   * /api/embed with array input).
   */
  embedMany(texts: string[], opts?: EmbeddingOptions): Promise<number[][]>;

  info(): EmbeddingProviderInfo;
}

export type EmbeddingProviderError = ProviderError;
