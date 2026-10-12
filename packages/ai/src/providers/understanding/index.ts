/**
 * Understanding provider index.
 *
 * Composes:
 *   - image description (Transformers.js local OR Gemini cloud)
 *   - TLDR (deterministic / Ollama local / Gemini cloud)
 *
 * The factory inspects the same `AiConfig` used elsewhere so the
 * zero-paid-AI guarantees are not duplicated here.
 *
 * The shared Gemini HTTP client is built once per process and reused
 * for every Gemini call. Pass `geminiClient` to inject a pre-built
 * client for tests; otherwise the factory builds one via
 * {@link buildGeminiClient}.
 */

import type { AiConfig } from "../../ai-config.js";
import { buildGeminiClient, type GeminiClient } from "../../gemini-client.js";
import {
  LocalImageDescriptionProvider,
  type LocalImageDescriptionProviderOptions
} from "./local-image-description.js";
import { DeterministicTldrProvider } from "./deterministic-tldr.js";
import { OllamaTldrProvider } from "./ollama-tldr.js";
import { GeminiTldrProvider } from "./gemini-tldr.js";
import { GeminiImageDescriptionProvider } from "./gemini-image-description.js";
import type {
  ImageDescriptionProvider,
  TldrProvider
} from "../../understanding/types.js";

export type {
  ImageDescriptionProvider,
  ImageDescriptionInput,
  ImageDescriptionResult,
  TldrProvider,
  TldrInput,
  TldrResult
} from "../../understanding/types.js";

export { LocalImageDescriptionProvider } from "./local-image-description.js";
export { DeterministicTldrProvider } from "./deterministic-tldr.js";
export { OllamaTldrProvider } from "./ollama-tldr.js";
export { GeminiTldrProvider } from "./gemini-tldr.js";
export { GeminiImageDescriptionProvider } from "./gemini-image-description.js";
export type { LocalImageDescriptionProviderOptions } from "./local-image-description.js";

export interface UnderstandingProviders {
  imageDescription: ImageDescriptionProvider;
  tldr: TldrProvider;
}

export interface BuildUnderstandingOptions {
  config: AiConfig;
  imageDescription?: LocalImageDescriptionProviderOptions;
  geminiClient?: GeminiClient;
  /**
   * Optional override for the TLDR request-execution budget. The
   * budget is request-execution only (queue wait is excluded), so
   * a longer value is appropriate for long PDF / text TLDR jobs.
   * Defaults to 90 000 ms.
   */
  tldrTotalBudgetMs?: number;
}

export function buildUnderstandingProviders(
  opts: BuildUnderstandingOptions
): UnderstandingProviders {
  const cfg = opts.config;
  const geminiClient = opts.geminiClient ?? buildGeminiClient();

  // Image description: local (Transformers.js) or Gemini cloud.
  // Gemini is the production target; local is kept for offline
  // development. We never silently fall back: if the configured
  // provider is "gemini" and the call fails, the failure bubbles
  // up to the job handler, which decides whether to fall back.
  let imageDescription: ImageDescriptionProvider;
  if (cfg.understanding.imageDescriptionProvider === "gemini") {
    const apiKey = cfg.text.geminiApiKey ?? cfg.embeddings.geminiApiKey;
    if (!apiKey) {
      throw new Error(
        "AI_IMAGE_DESCRIPTION_PROVIDER=gemini but GEMINI_API_KEY is empty. " +
          "Set GEMINI_API_KEY in .env or switch AI_IMAGE_DESCRIPTION_PROVIDER=local."
      );
    }
    imageDescription = new GeminiImageDescriptionProvider(
      apiKey,
      cfg.text.geminiModel,
      geminiClient
    );
  } else {
    imageDescription = new LocalImageDescriptionProvider(
      opts.imageDescription ?? {
        modelName: cfg.understanding.localImageModel || undefined,
        allowDownload: cfg.understanding.allowDownload
      }
    );
  }

  // TLDR chain: deterministic always wins the floor. Ollama and
  // Gemini are explicit upgrades, never silent.
  if (cfg.understanding.tldrProvider === "gemini") {
    const apiKey = cfg.text.geminiApiKey ?? cfg.embeddings.geminiApiKey;
    if (!apiKey) {
      throw new Error(
        "AI_TLDR_PROVIDER=gemini but GEMINI_API_KEY is empty. " +
          "Set GEMINI_API_KEY in .env or switch AI_TLDR_PROVIDER=deterministic."
      );
    }
    return {
      imageDescription,
      tldr: new GeminiTldrProvider(apiKey, cfg.text.geminiModel, geminiClient, {
        maxLength: cfg.understanding.tldrMaxLength,
        totalBudgetMs: opts.tldrTotalBudgetMs ?? 90_000
      })
    };
  }
  if (cfg.understanding.tldrProvider === "ollama") {
    return {
      imageDescription,
      tldr: new OllamaTldrProvider({
        forceCpu: cfg.ollamaForceCpu
      })
    };
  }
  return {
    imageDescription,
    tldr: new DeterministicTldrProvider()
  };
}