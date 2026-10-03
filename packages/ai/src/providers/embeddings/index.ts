/**
 * Provider factory for text embeddings.
 *
 * Selection rules (in order):
 *  1. AI_FREE_ONLY=true forces provider=gemini or noop (validated in
 *     ai-config).
 *  2. If the provider is "openai" but no key is set, fall back to
 *     "noop" in production, "openai" in demo (the OpenAI provider
 *     will then fail with a clear ProviderError on first call).
 *  3. If the provider is "gemini" but no key is set, fall back to
 *     "noop" in production. Demo mode: still "noop" — there is no
 *     mock-gemini path on purpose.
 *
 * Fallback: when config.embeddings.embeddingsFallback is true and
 * the primary is gemini/openai, wrap in FallingBackEmbeddingProvider
 * with NoopEmbeddingProvider as the secondary. The secondary throws
 * on call, which means the search route's caller will see an empty
 * semantic results list (graceful lexical-only degradation).
 */

import type { AiConfig } from "../../ai-config.js";
import type { EmbeddingProvider } from "./types.js";
import { GeminiEmbeddingProvider } from "./gemini.js";
import { OpenAIEmbeddingProvider } from "./openai.js";
import { NoopEmbeddingProvider } from "./noop.js";
import { FallingBackEmbeddingProvider } from "./fallback.js";

export function buildEmbeddingProvider(config: AiConfig): EmbeddingProvider {
  const primary = pickPrimary(config);
  if (!config.embeddings.embeddingsFallback || primary.info().name === "noop") {
    return primary;
  }
  const fallback = new NoopEmbeddingProvider(config.embeddings.geminiDimensions);
  return new FallingBackEmbeddingProvider(primary, fallback);
}

function pickPrimary(config: AiConfig): EmbeddingProvider {
  switch (config.embeddings.provider) {
    case "gemini": {
      if (!config.embeddings.geminiApiKey) {
        return new NoopEmbeddingProvider(config.embeddings.geminiDimensions);
      }
      return new GeminiEmbeddingProvider(
        config.embeddings.geminiApiKey,
        config.embeddings.geminiModel,
        config.embeddings.geminiDimensions
      );
    }
    case "openai": {
      if (config.freeOnly) {
        // Defensive: ai-config already throws on this, but the
        // factory must not produce a paid provider under freeOnly.
        throw new Error(
          "buildEmbeddingProvider: AI_FREE_ONLY forbids openai. " +
            "This is a bug in ai-config.ts."
        );
      }
      if (!config.embeddings.openaiApiKey) {
        return new NoopEmbeddingProvider(1536);
      }
      return new OpenAIEmbeddingProvider(
        config.embeddings.openaiApiKey,
        config.embeddings.openaiModel,
        1536
      );
    }
    case "noop":
      return new NoopEmbeddingProvider(config.embeddings.geminiDimensions);
    default: {
      const _exhaustive: never = config.embeddings.provider;
      throw new Error(`Unknown embedding provider: ${String(_exhaustive)}`);
    }
  }
}

export type { EmbeddingProvider, EmbeddingProviderInfo, EmbeddingOptions } from "./types.js";
export { GeminiEmbeddingProvider } from "./gemini.js";
export { OpenAIEmbeddingProvider } from "./openai.js";
export { NoopEmbeddingProvider } from "./noop.js";
export { FallingBackEmbeddingProvider } from "./fallback.js";
