/**
 * Provider factory for text generation. Returns the right concrete
 * provider based on AiConfig, or throws if the requested provider is
 * unavailable.
 *
 * Selection:
 *   - AI_TEXT_PROVIDER=gemini  → GeminiTextProvider (if key set)
 *   - AI_TEXT_PROVIDER=ollama  → OllamaTextProvider (always; baseUrl
 *     is read from config.text.ollamaBaseUrl)
 *   - AI_TEXT_PROVIDER=heuristic → HeuristicTextProvider
 *
 * Fallback: when config.text.textFallback is true and the primary is
 * gemini/ollama, wrap it in FallingBackTextProvider with a deterministic
 * secondary. Secondary chain:
 *   - gemini primary   → fallback Ollama (then Heuristic on Ollama fail)
 *   - ollama primary   → fallback Heuristic (no further local option)
 *   - heuristic primary → no fallback (it's already the floor)
 */

import type { AiConfig } from "../../ai-config.js";
import type { TextProvider } from "./types.js";
import { GeminiTextProvider } from "./gemini.js";
import { OllamaTextProvider } from "./ollama.js";
import { HeuristicTextProvider } from "./heuristic.js";
import { FallingBackTextProvider } from "./fallback.js";

export function buildTextProvider(config: AiConfig): TextProvider {
  const primary = pickPrimary(config);
  if (!config.text.textFallback || primary.info().name === "heuristic") {
    return primary;
  }
  const fallback = pickFallback(config, primary);
  if (!fallback) return primary;
  return new FallingBackTextProvider(primary, fallback);
}

function pickPrimary(config: AiConfig): TextProvider {
  switch (config.text.provider) {
    case "gemini": {
      if (!config.text.geminiApiKey) {
        // Spec contract: missing AI quota must degrade gracefully.
        // The item must still become usable. Falling back to the
        // deterministic keyword heuristic is the lowest-cost path
        // that satisfies this. We log a warning so an operator
        // running the app notices the degraded state, but we do
        // not crash the boot path.
        console.warn(
          "[ai/text] AI_TEXT_PROVIDER=gemini but GEMINI_API_KEY is empty. " +
            "Falling back to deterministic heuristic. Set GEMINI_API_KEY " +
            "in .env to enable Gemini tag generation."
        );
        return new HeuristicTextProvider();
      }
      return new GeminiTextProvider(config.text.geminiApiKey, config.text.geminiModel);
    }
    case "ollama": {
      return new OllamaTextProvider(
        config.text.ollamaBaseUrl ?? "http://localhost:11434",
        config.text.ollamaTextModel
      );
    }
    case "heuristic":
      return new HeuristicTextProvider();
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = config.text.provider;
      throw new Error(`Unknown text provider: ${String(_exhaustive)}`);
    }
  }
}

function pickFallback(
  config: AiConfig,
  primary: TextProvider
): TextProvider | null {
  const primaryName = primary.info().name;
  if (primaryName === "gemini") {
    return new OllamaTextProvider(
      config.text.ollamaBaseUrl ?? "http://localhost:11434",
      config.text.ollamaTextModel
    );
  }
  if (primaryName === "ollama") {
    return new HeuristicTextProvider();
  }
  return null;
}

export type { TextProvider, TextProviderInfo, TextGenerationOptions } from "./types.js";
export { HeuristicTextProvider } from "./heuristic.js";
export { GeminiTextProvider } from "./gemini.js";
export { OllamaTextProvider } from "./ollama.js";
export { FallingBackTextProvider } from "./fallback.js";
