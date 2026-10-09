/**
 * Gemini image-description provider.
 *
 * Sends the image to Gemini's multimodal `generateContent` endpoint
 * and asks for a short, factual caption. The model used here is the
 * same model configured for general text/image understanding
 * (`GEMINI_MODEL`, default `gemini-3.8-flash`).
 *
 * Important contract decisions:
 *
 *   - The provider NEVER fabricates a caption when the call fails.
 *     On every failure (auth, rate limit, network, malformed
 *     input) the provider THROWS a `ProviderError`. The job
 *     handler is responsible for the fallback policy.
 *   - The provider NEVER downloads a local model. The previous
 *     `LocalImageDescriptionProvider` (Transformers.js) is still
 *     available for offline development; in production, this
 *     Gemini provider is the one wired in by
 *     `buildUnderstandingProviders()`.
 *   - Bounded input. Images > 10 MB are rejected with
 *     `INPUT_TOO_LARGE` so a single bad capture cannot exhaust
 *     the request body budget.
 *   - The returned `revision` is the SHA-256 of the image bytes;
 *     the job handler can use it to short-circuit duplicate
 *     descriptions.
 *
 * Privacy: the image bytes are POSTed to the Gemini Developer API
 * over HTTPS. The Free Tier (per Google AI Studio docs) MAY use
 * inputs to improve the model; the operator must surface a privacy
 * notice before enabling this provider. See docs/privacy.md.
 */

import { createHash } from "node:crypto";
import { ProviderError } from "../../types.js";
import { GeminiClient, type GeminiTask } from "../../gemini-client.js";
import type {
  ImageDescriptionInput,
  ImageDescriptionResult
} from "../../understanding/types.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const PROMPT = `You describe images for a personal second-brain product.
Write a single short caption (≤ 200 chars) that captures what the
image is and what is happening in it. Be concrete: name objects,
text, and the dominant action. Do not start with 'A picture of' or
'This image shows'. Return only the caption, no preamble, no
markdown fences.`;

export class GeminiImageDescriptionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly client: GeminiClient
  ) {
    if (!apiKey) throw new Error("GeminiImageDescriptionProvider: apiKey is required");
  }

  info(): { name: string; model: string; loaded: boolean } {
    return { name: "gemini", model: this.model, loaded: true };
  }

  async describe(input: ImageDescriptionInput): Promise<ImageDescriptionResult> {
    if (!input.bytes || input.bytes.length === 0) {
      throw new ProviderError({
        message: "GeminiImageDescriptionProvider: empty input bytes",
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    if (input.bytes.length > MAX_IMAGE_BYTES) {
      throw new ProviderError({
        message: `GeminiImageDescriptionProvider: image is ${input.bytes.length} bytes, exceeding the ${MAX_IMAGE_BYTES} byte cap`,
        code: "INPUT_TOO_LARGE",
        provider: "gemini",
        retryable: false
      });
    }
    if (!input.mimeType.startsWith("image/")) {
      throw new ProviderError({
        message: `GeminiImageDescriptionProvider: only image/* MIME types are supported, got ${input.mimeType}`,
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    const data = await this.client.call<{
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    }>({
      apiKey: this.apiKey,
      model: this.model,
      task: "multimodal" satisfies GeminiTask,
      path: `models/${encodeURIComponent(this.model)}:generateContent`,
      body: {
        contents: [
          {
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  mime_type: input.mimeType,
                  data: bytesToBase64(input.bytes)
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 256
        }
      },
      totalBudgetMs: DEFAULT_TIMEOUT_MS
    });
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const caption = raw.trim().slice(0, 200);
    if (!caption) {
      // The model produced an empty result. Surface as an error so
      // the job handler can decide whether to fall back to the
      // deterministic placeholder. We do NOT silently return an
      // empty caption — that is a product lie.
      throw new ProviderError({
        message: "Gemini returned an empty caption",
        code: "EMPTY_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    return {
      caption,
      confidence: 0.8,
      model: this.model,
      provider: "gemini",
      revision: createHash("sha256").update(input.bytes).digest("hex").slice(0, 16)
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
