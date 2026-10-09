/**
 * Provider factory for visual embeddings.
 *
 * Two providers:
 *   - "local" (CLIP via @huggingface/transformers) — development
 *     and offline use.
 *   - "gemini" (multimodal embedding endpoint) — production
 *     target. Vectors are stored in a separate table
 *     (`item_visual_embeddings`, 512-d) and are NEVER mixed with
 *     text embeddings. See the Free-Tier caveat in
 *     `GeminiVisualEmbeddingProvider`.
 *
 * The free-only guard in `loadAiConfig` refuses to mount
 * VISUAL_EMBEDDING_PROVIDER=gemini when the configured visual
 * model is not on the verified-Free list.
 */

import type { AiConfig } from "../../ai-config.js";
import { buildGeminiClient, type GeminiClient } from "../../gemini-client.js";
import type { VisualProvider } from "./types.js";
import { ClipLocalProvider } from "./clip.js";
import { GeminiVisualEmbeddingProvider } from "./gemini.js";

export function buildVisualProvider(
  config: AiConfig,
  client?: GeminiClient
): VisualProvider {
  switch (config.vision.provider) {
    case "local":
      return new ClipLocalProvider(config.vision.clipModel, 512);
    case "gemini": {
      const apiKey = config.text.geminiApiKey ?? config.embeddings.geminiApiKey;
      if (!apiKey) {
        throw new Error(
          "VISUAL_EMBEDDING_PROVIDER=gemini but GEMINI_API_KEY is empty. " +
            "Set GEMINI_API_KEY in .env or switch VISUAL_EMBEDDING_PROVIDER=local."
        );
      }
      return new GeminiVisualEmbeddingProvider(
        apiKey,
        config.vision.geminiVisualModel,
        config.vision.geminiVisualDimensions,
        client ?? buildGeminiClient()
      );
    }
    default: {
      const _exhaustive: never = config.vision.provider;
      throw new Error(`Unknown visual provider: ${String(_exhaustive)}`);
    }
  }
}

export type { VisualProvider, VisualInput, VisualEmbeddingResult, VisualProviderInfo } from "./types.js";
export { ClipLocalProvider } from "./clip.js";
export { GeminiVisualEmbeddingProvider } from "./gemini.js";
