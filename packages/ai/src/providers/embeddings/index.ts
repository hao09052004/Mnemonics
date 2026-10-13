/**
 * Provider factory for text embeddings.
 *
 * Selection rules (in order):
 *  1. AI_EMBEDDING_PROVIDER is "gemini" (default) or "noop". OpenAI
 *     is intentionally NOT selectable — the product contract is
 *     "Gemini first, never OpenAI".
 *  2. If the provider is "gemini" but no key is set, fall back to
 *     "noop" (lexical-only search).
 *  3. If the provider is "noop", use the noop provider directly.
 *
 * Fallback chain when config.embeddings.embeddingsFallback is true:
 *   gemini -> noop  (refuses; search degrades to lexical-only)
 *
 * The chain always terminates at noop so the chain can never be empty:
 * a ProviderError from noop surfaces as an honest lexical-only search.
 */

import type { AiConfig } from "../../ai-config.js";
import { buildGeminiClient, type GeminiClient } from "../../gemini-client.js";
import type { EmbeddingProvider } from "./types.js";
import { GeminiEmbeddingProvider } from "./gemini.js";
import { NoopEmbeddingProvider } from "./noop.js";
import { FallingBackEmbeddingProvider } from "./fallback.js";

export function buildEmbeddingProvider(
  config: AiConfig,
  client?: GeminiClient
): EmbeddingProvider {
  const geminiClient = client ?? buildGeminiClient();
  const primary = pickPrimary(config, geminiClient);
  if (!config.embeddings.embeddingsFallback || primary.info().name === "noop") {
    return primary;
  }

  const fallback = pickFallback(config, primary, geminiClient);
  if (!fallback) return primary;
  return new FallingBackEmbeddingProvider(primary, fallback);
}

function pickPrimary(config: AiConfig, geminiClient: GeminiClient): EmbeddingProvider {
  switch (config.embeddings.provider) {
    case "gemini": {
      if (!config.embeddings.geminiApiKey) {
        // No key: drop straight to noop (lexical-only search). The
        // operator must set GEMINI_API_KEY for semantic embeddings.
        return new NoopEmbeddingProvider(config.embeddings.geminiDimensions);
      }
      return new GeminiEmbeddingProvider(
        config.embeddings.geminiApiKey,
        config.embeddings.geminiModel,
        config.embeddings.geminiDimensions,
        geminiClient
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

function pickFallback(
  config: AiConfig,
  primary: EmbeddingProvider,
  _geminiClient: GeminiClient
): EmbeddingProvider | null {
  const primaryInfo = primary.info();

  // A noop primary has nothing left to fall back to.
  if (primaryInfo.name === "noop") return null;

  // Always terminate at noop so the chain can never be empty.
  return new NoopEmbeddingProvider(primaryInfo.dimensions);
}

export type { EmbeddingProvider, EmbeddingProviderInfo, EmbeddingOptions } from "./types.js";
export { GeminiEmbeddingProvider } from "./gemini.js";
export { NoopEmbeddingProvider } from "./noop.js";
export { FallingBackEmbeddingProvider } from "./fallback.js";
