/**
 * Gemini visual embedding provider.
 *
 * Generates visual embeddings via Gemini's multimodal embedding
 * endpoint (`models/<model>:embedContent` with an inline image
 * part). The provider is intentionally kept SEPARATE from the
 * text embedding path:
 *
 *   - The model identity is different (visual model vs.
 *     `gemini-embedding-001`). Storing a visual vector in
 *     `item_embeddings.embedding` would silently corrupt the
 *     text similarity graph because the two spaces are not
 *     comparable.
 *   - The dimension count is independent (visual defaults to 512
 *     here; text uses 1024 to match `item_embeddings.embedding`).
 *
 * For the V1 cut the provider writes nothing to the database —
 * it only exposes the vectors through `embed()`. The schema
 * migration that adds a dedicated `item_visual_embeddings` table
 * is a separate, additive migration (see migration 025 in the
 * migration queue). Until that lands, the provider is a leaf —
 * `warmup()` succeeds and `embed()` returns a vector, but the
 * repo does not yet persist it.
 *
 * Free-Tier caveat: the multimodal embedding endpoint is NOT
 * available on the Gemini Developer API Free Tier as of the
 * date in this file's history. The provider therefore fails
 * closed with `MODEL_NOT_FOUND` if the configured model is
 * unavailable on the operator's key. The factory refuses to
 * mount this provider when `AI_FREE_ONLY=true` and the model
 * is not on the verified-Free list (see `ai-config.ts`).
 *
 * Privacy: image bytes are POSTed to the Gemini Developer API
 * over HTTPS. The Free Tier (per Google AI Studio docs) MAY use
 * inputs to improve the model; the operator must surface a
 * privacy notice before enabling this provider.
 */

import { ProviderError } from "../../types.js";
import { GeminiClient, type GeminiTask } from "../../gemini-client.js";
import type {
  VisualProvider,
  VisualInput,
  VisualEmbeddingResult,
  VisualProviderInfo
} from "./types.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class GeminiVisualEmbeddingProvider implements VisualProvider {
  private loaded = false;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly client: GeminiClient
  ) {
    if (!apiKey) throw new Error("GeminiVisualEmbeddingProvider: apiKey is required");
  }

  async warmup(): Promise<void> {
    if (this.loaded) return;
    // No remote warmup; the model's first call loads it server-side.
    this.loaded = true;
  }

  info(): VisualProviderInfo {
    return {
      name: "gemini-visual",
      model: this.model,
      dimensions: this.dimensions,
      loaded: this.loaded
    };
  }

  async embed(input: VisualInput): Promise<VisualEmbeddingResult> {
    if (!input.bytes || input.bytes.length === 0) {
      throw new ProviderError({
        message: "GeminiVisualEmbeddingProvider: empty input bytes",
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    if (input.bytes.length > MAX_IMAGE_BYTES) {
      throw new ProviderError({
        message: `GeminiVisualEmbeddingProvider: image is ${input.bytes.length} bytes, exceeding the ${MAX_IMAGE_BYTES} byte cap`,
        code: "INPUT_TOO_LARGE",
        provider: "gemini",
        retryable: false
      });
    }
    if (!input.mimeType.startsWith("image/")) {
      throw new ProviderError({
        message: `GeminiVisualEmbeddingProvider: only image/* MIME types are supported, got ${input.mimeType}`,
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    const data = await this.client.call<{
      embedding?: { values?: number[] };
    }>({
      apiKey: this.apiKey,
      model: this.model,
      task: "visual-embedding" satisfies GeminiTask,
      path: `models/${encodeURIComponent(this.model)}:embedContent`,
      body: {
        content: {
          parts: [
            {
              inline_data: {
                mime_type: input.mimeType,
                data: bytesToBase64(input.bytes)
              }
            }
          ]
        },
        outputDimensionality: this.dimensions
      },
      totalBudgetMs: 30_000
    });
    const vec = data.embedding?.values ?? [];
    if (vec.length === 0) {
      throw new ProviderError({
        message: "Gemini returned no visual embedding",
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    if (vec.length !== this.dimensions) {
      // Surface a clear error rather than silently truncating /
      // padding — a mismatched-dimension vector would corrupt
      // similarity scoring.
      throw new ProviderError({
        message: `Gemini returned ${vec.length}-d visual embedding, but the configured dimension is ${this.dimensions}. Refusing to store a wrong-width vector.`,
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    return {
      vector: vec,
      model: this.model
    };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
