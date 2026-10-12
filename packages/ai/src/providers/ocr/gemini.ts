/**
 * Gemini OCR provider.
 *
 * Uses the Gemini multimodal `generateContent` endpoint to read
 * text from an image (screenshot, scan, photo). The model used
 * here is the same model configured for general text/image
 * understanding (`GEMINI_MODEL`, default `gemini-3.8-flash`):
 * Gemini's text model handles inline image inputs natively, so we
 * do not need a separate "vision" model just for OCR.
 *
 * Why this exists:
 *
 *   - The free OCR.Space endpoint is rate-limited (25 000 req/mo,
 *     per-IP) and frequently returns 4xx for screenshots taken at
 *     unusual sizes. Local Tesseract downloads a 30 MB WASM blob.
 *   - Gemini on the Free Tier handles screenshots well and is
 *     already wired in for tags / TLDR.
 *
 * Failure policy:
 *
 *   - 4xx (bad request, auth, not found): non-retryable. The image
 *     is malformed or the API key is wrong; retrying cannot help.
 *   - 5xx, 429, network, timeout: retryable. The shared
 *     {@link GeminiClient} handles the backoff and the
 *     circuit breaker.
 *
 * Privacy: the image bytes are POSTed to the Gemini Developer API
 * over HTTPS. The Free Tier (per Google AI Studio docs) MAY use
 * inputs to improve the model; the operator must surface a privacy
 * notice to the end user before enabling this provider. See
 * docs/privacy.md.
 *
 * Line breaks: the model is prompted to preserve visible line
 * breaks, but the returned text is normalised to LF and trimmed
 * before being returned to the OCR contract.
 *
 * Empty result: a screenshot with no visible text returns an
 * empty `OcrResult.text` (with `engine: "gemini"`). The job
 * handler's fallback chain will then call the configured fallback
 * (Tesseract / OCR.Space) if a non-empty result is required.
 */

import { ProviderError } from "../../types.js";
import { GeminiClient, type GeminiTask } from "../../gemini-client.js";
import type { OcrInput, OcrOptions, OcrProvider, OcrResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB safety cap

const OCR_PROMPT = `Extract every piece of visible text from this image.
Preserve line breaks. Do not invent text that is not visible.
If the image contains no text, return an empty string.
Return ONLY the extracted text, no preamble, no commentary, no markdown fences.`;

export class GeminiOcrProvider implements OcrProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly client: GeminiClient
  ) {
    if (!apiKey) throw new Error("GeminiOcrProvider: apiKey is required");
  }

  info(): { name: string; model: string } {
    return { name: "gemini", model: this.model };
  }

  async recognize(input: OcrInput, opts?: OcrOptions): Promise<OcrResult> {
    if (!input.bytes || input.bytes.length === 0) {
      throw new ProviderError({
        message: "GeminiOcrProvider: empty input bytes",
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    if (input.bytes.length > MAX_IMAGE_BYTES) {
      throw new ProviderError({
        message: `GeminiOcrProvider: image is ${input.bytes.length} bytes, exceeding the ${MAX_IMAGE_BYTES} byte cap`,
        code: "INPUT_TOO_LARGE",
        provider: "gemini",
        retryable: false
      });
    }
    if (!input.mimeType.startsWith("image/")) {
      throw new ProviderError({
        message: `GeminiOcrProvider: only image/* MIME types are supported, got ${input.mimeType}`,
        code: "INVALID_RESPONSE",
        provider: "gemini",
        retryable: false
      });
    }
    const totalBudgetMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
              { text: OCR_PROMPT },
              {
                inline_data: {
                  mime_type: input.mimeType,
                  // Gemini expects base64; the HTTP client serialises
                  // bytes as a UTF-8 string otherwise.
                  data: bytesToBase64(input.bytes)
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      },
      totalBudgetMs
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const normalised = text.replace(/\r\n/g, "\n").trim();
    if (!normalised) {
      // No visible text — do not invent one. The caller decides
      // whether the fallback chain is invoked.
      return {
        text: "",
        engine: "gemini",
        language: input.language
      };
    }
    return {
      text: normalised,
      engine: "gemini",
      language: input.language
    };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  // Browser fallback (not used by the API but keeps the file
  // portable).
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
