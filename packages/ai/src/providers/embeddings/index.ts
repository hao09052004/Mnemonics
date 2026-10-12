/**
 * Provider factory for text embeddings.
 *
 * Selection rules (in order):
 *  1. AI_EMBEDDING_PROVIDER is "gemini" (default) or "ollama" (local)
 *     or "noop". OpenAI is intentionally NOT selectable — the product
 *     contract is "Gemini first, local second, never OpenAI".
 *  2. If the provider is "gemini" but no key is set, fall back to the
 *     LOCAL provider (Ollama) when a 1024-d local model is configured,
 *     else to "noop".
 *  3. If the provider is "ollama", use the local provider directly.
 *
 * Fallback chain when config.embeddings.embeddingsFallback is true:
 *   gemini -> ollama (local, real 1024-d vectors)
 *          -> noop  (refuses; search degrades to lexical-only)
 *
 * The local step matters: it is a REAL semantic fallback, not a silent
 * degradation, because both providers emit exactly 1024-d vectors into
 * the same `vector(1024)` column (migration 017). Mixing embedding
 * spaces in one column silently corrupts nearest-neighbour ranking, so
 * the factory refuses to build a chain whose widths disagree.
 */

import type { AiConfig } from "../../ai-config.js";
import { buildGeminiClient, type GeminiClient } from "../../gemini-client.js";
import type { EmbeddingProvider } from "./types.js";
import { GeminiEmbeddingProvider } from "./gemini.js";
import {
  OllamaEmbeddingProvider,
  LOCAL_EMBEDDING_DIMENSIONS,
} from "./ollama.js";
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

function buildLocal(config: AiConfig): OllamaEmbeddingProvider {
  return new OllamaEmbeddingProvider(
    config.embeddings.ollamaBaseUrl ?? "http://localhost:11434",
    config.embeddings.ollamaEmbeddingModel,
    config.embeddings.geminiDimensions,
    config.ollamaForceCpu
  );
}

function pickPrimary(config: AiConfig, geminiClient: GeminiClient): EmbeddingProvider {
  switch (config.embeddings.provider) {
    case "gemini": {
      if (!config.embeddings.geminiApiKey) {
        // No key: prefer the local model over dropping to noop, so a
        // developer without a Gemini key still gets semantic search.
        return buildLocalOrNoop(config);
      }
      return new GeminiEmbeddingProvider(
        config.embeddings.geminiApiKey,
        config.embeddings.geminiModel,
        config.embeddings.geminiDimensions,
        geminiClient
      );
    }
    case "ollama":
      return buildLocalOrNoop(config);
    case "noop":
      return new NoopEmbeddingProvider(config.embeddings.geminiDimensions);
    default: {
      const _exhaustive: never = config.embeddings.provider;
      throw new Error(`Unknown embedding provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Build the local provider, but only when its width is compatible with
 * the column. A misconfigured OLLAMA_EMBEDDING_MODEL that would emit the
 * wrong width degrades to noop (lexical-only search) instead of throwing
 * at boot or writing vectors that cannot be compared.
 */
function buildLocalOrNoop(config: AiConfig): EmbeddingProvider {
  if (config.embeddings.geminiDimensions !== LOCAL_EMBEDDING_DIMENSIONS) {
    return new NoopEmbeddingProvider(config.embeddings.geminiDimensions);
  }
  return buildLocal(config);
}

function pickFallback(
  config: AiConfig,
  primary: EmbeddingProvider,
  geminiClient: GeminiClient
): EmbeddingProvider | null {
  const primaryInfo = primary.info();

  // A noop primary has nothing left to fall back to.
  if (primaryInfo.name === "noop") return null;

  // Only bridge to a DIFFERENT provider, and only when the widths match.
  const candidates: EmbeddingProvider[] = [];
  if (primaryInfo.name === "gemini") {
    if (config.embeddings.geminiDimensions === LOCAL_EMBEDDING_DIMENSIONS) {
      candidates.push(buildLocal(config));
    }
  } else if (primaryInfo.name === "ollama" && config.embeddings.geminiApiKey) {
    candidates.push(
      new GeminiEmbeddingProvider(
        config.embeddings.geminiApiKey,
        config.embeddings.geminiModel,
        config.embeddings.geminiDimensions,
        geminiClient
      )
    );
  }

  for (const candidate of candidates) {
    if (candidate.info().dimensions === primaryInfo.dimensions) {
      return candidate;
    }
  }

  // Always terminate at noop so the chain can never be empty: a
  // ProviderError from noop surfaces as an honest lexical-only search.
  return new NoopEmbeddingProvider(primaryInfo.dimensions);
}

export type { EmbeddingProvider, EmbeddingProviderInfo, EmbeddingOptions } from "./types.js";
export { GeminiEmbeddingProvider } from "./gemini.js";
export { OllamaEmbeddingProvider, LOCAL_EMBEDDING_DIMENSIONS } from "./ollama.js";
export { NoopEmbeddingProvider } from "./noop.js";
export { FallingBackEmbeddingProvider } from "./fallback.js";
