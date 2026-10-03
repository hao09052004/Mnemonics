/**
 * "No-op" embedding provider.
 *
 * Selected only when AI_EMBEDDING_PROVIDER=noop. This provider REFUSES
 * to produce fake vectors: every call throws ProviderError.
 *
 * Why this exists: the previous architecture silently generated a
 * deterministic sin-based mock in the absence of an OpenAI key. That
 * behaviour is unsafe — it lets a missing API key pass a smoke test
 * while producing semantically-meaningless vectors. We replace it
 * with an explicit refusal so the caller is forced to either:
 *  - configure a real key, OR
 *  - mark semantic enrichment as degraded and continue with lexical
 *    search.
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
        "Configure AI_EMBEDDING_PROVIDER=gemini with a valid GEMINI_API_KEY " +
        "or accept lexical-only search.",
      code: "PROVIDER_UNAVAILABLE",
      provider: "noop",
      retryable: false,
    });
  }

  async embedMany(_texts: string[], _opts?: EmbeddingOptions): Promise<number[][]> {
    throw new ProviderError({
      message:
        "Embedding provider is 'noop'. No real embedding was produced. " +
        "Configure AI_EMBEDDING_PROVIDER=gemini with a valid GEMINI_API_KEY " +
        "or accept lexical-only search.",
      code: "PROVIDER_UNAVAILABLE",
      provider: "noop",
      retryable: false,
    });
  }

  info(): EmbeddingProviderInfo {
    return { name: "noop", model: "none", dimensions: this.dimensions };
  }
}
