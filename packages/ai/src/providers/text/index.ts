/**
 * Provider factory for text generation. Returns the right concrete
 * provider based on AiConfig, or throws if the requested provider is
 * unavailable.
 */

import type { AiConfig } from "../../ai-config.js";
import type { TextProvider } from "./types.js";
import { GeminiTextProvider } from "./gemini.js";
import { HeuristicTextProvider } from "./heuristic.js";

export function buildTextProvider(config: AiConfig): TextProvider {
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
    case "heuristic":
      return new HeuristicTextProvider();
    default:
      // Exhaustiveness check.
      const _exhaustive: never = config.text.provider;
      throw new Error(`Unknown text provider: ${String(_exhaustive)}`);
  }
}

export type { TextProvider, TextProviderInfo, TextGenerationOptions } from "./types.js";
export { HeuristicTextProvider } from "./heuristic.js";
export { GeminiTextProvider } from "./gemini.js";
