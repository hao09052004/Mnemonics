/**
 * "No-op" embedding provider.
 *
 * Selected only when NO real provider is usable — neither Gemini (no
 * key / failing) nor a local model of the right width. This provider
 * REFUSES to produce fake vectors: every call throws ProviderError.
 *
 * Why this exists: an earlier architecture silently generated a
 * deterministic sin-based mock when no API key was configured. That
 * behaviour is unsafe — it lets a missing key pass a smoke test while
 * producing semantically-meaningless vectors, and those vectors get
 * compared against real query vectors at search time. We use an
 * explicit refusal so the caller is forced to either configure a real
 * provider OR accept lexical-only search.
 */

import { ProviderError } from "../../types.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingOptions,
} from "./types.js";

export class NoopEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions: number) {}

  async embedOne(_text: string, _opts?: EmbeddingOptions): Promise<number[]> {
    throw new ProviderError({
      message:
        "Embedding provider is 'noop'. No real embedding was produced. " +
        "Configure GEMINI_API_KEY, or run 'ollama pull bge-m3' for the " +
        "local 1024-d fallback, or accept lexical-only search.",
      code: "PROVIDER_UNAVAILABLE",
      provider: "noop",
      retryable: false,
    });
  }

  async embedMany(_texts: string[], _opts?: EmbeddingOptions): Promise<number[][]> {
    throw new ProviderError({
      message:
        "Embedding provider is 'noop'. No real embedding was produced. " +
        "Configure GEMINI_API_KEY, or run 'ollama pull bge-m3' for the " +
        "local 1024-d fallback, or accept lexical-only search.",
      code: "PROVIDER_UNAVAILABLE",
      provider: "noop",
      retryable: false,
    });
  }

  info(): EmbeddingProviderInfo {
    return { name: "noop", model: "none", dimensions: this.dimensions };
  }
}
