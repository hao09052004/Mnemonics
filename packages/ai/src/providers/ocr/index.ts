/**
 * Provider factory for OCR.
 *
 * Returns the primary provider selected by config. The
 * primary→fallback chaining (gemini → ocrspace → tesseract) is
 * performed by the caller (the OCR job handler) using the
 * `recognizeWithFallback` helper below, so the provider objects
 * stay stateless and easy to test.
 *
 * Production target: OCR_PROVIDER=gemini (multimodal text
 * extraction). The other providers are kept for offline
 * development and as deterministic fallbacks when Gemini is
 * unavailable.
 */

import type { AiConfig } from "../../ai-config.js";
import type { OcrProvider, OcrInput, OcrOptions, OcrResult } from "./types.js";
import {
  OcrSpaceProvider,
  InMemoryDailyCounter,
  type OcrSpaceDailyCounter
} from "./ocrspace.js";
import { TesseractOcrProvider } from "./tesseract.js";
import { GeminiOcrProvider } from "./gemini.js";
import type { GeminiClient } from "../../gemini-client.js";

export function buildOcrProvider(
  config: AiConfig,
  counter?: OcrSpaceDailyCounter,
  geminiClient?: GeminiClient
): OcrProvider {
  switch (config.ocr.provider) {
    case "gemini": {
      if (!config.ocr.ocrSpaceApiKey) {
        // noop here: falls through to the explicit branch below
      }
      const apiKey = config.text.geminiApiKey ?? config.embeddings.geminiApiKey;
      if (!apiKey) {
        // The configured primary is Gemini, but no API key is set.
        // Refuse to silently fall back to OCR.Space (a different
        // paid/quota'd provider) or Tesseract (downloads a 30 MB
        // WASM blob) — the operator should either set the key or
        // switch OCR_PROVIDER explicitly. Falling back to Tesseract
        // would also pull a local model the operator may have
        // configured OFF for production.
        throw new Error(
          "OCR_PROVIDER=gemini but GEMINI_API_KEY is empty. Set GEMINI_API_KEY in .env " +
            "or switch OCR_PROVIDER to ocrspace / tesseract."
        );
      }
      return new GeminiOcrProvider(apiKey, config.text.geminiModel, geminiClient!);
    }
    case "ocrspace": {
      if (!config.ocr.ocrSpaceApiKey) {
        // No key: behave as if local fallback was requested. The
        // job handler will then call recognizeWithFallback to chain.
        return new TesseractOcrProvider();
      }
      return new OcrSpaceProvider(
        config.ocr.ocrSpaceApiKey,
        counter ?? new InMemoryDailyCounter(config.ocr.ocrSpaceDailySoftLimit)
      );
    }
    case "tesseract":
      return new TesseractOcrProvider();
    default: {
      const _exhaustive: never = config.ocr.provider;
      throw new Error(`Unknown OCR provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Try the primary provider, fall back to the secondary on retryable
 * errors OR when the primary returns an empty string. Images are
 * always preserved upstream of this function; failure is enrichment,
 * not save-boundary.
 *
 * For the Gemini-first production chain the caller passes
 * `primary = gemini`, `fallback = ocrspace` (or tesseract). The
 * worker can chain a second fallback via a second call to this
 * helper, but most call sites only need the two-step chain.
 */
export async function recognizeWithFallback(
  primary: OcrProvider,
  fallback: OcrProvider,
  input: OcrInput,
  opts?: OcrOptions
): Promise<OcrResult> {
  try {
    const out = await primary.recognize(input, opts);
    if (out.text && out.text.length > 0) return out;
    // Empty result from a working provider: try the fallback only
    // if it would actually be different. Tesseract is meaningfully
    // different from ocrspace on noisy images.
    if (fallback !== primary) {
      try {
        const fb = await fallback.recognize(input, opts);
        if (fb.text && fb.text.length > 0) return fb;
        return out;
      } catch {
        return out;
      }
    }
    return out;
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "INVALID_API_KEY"
    ) {
      // Auth error: do not retry, do not fall back — surface the
      // problem so the user knows to set the key.
      throw err;
    }
    if (fallback === primary) throw err;
    const fb = await fallback.recognize(input, opts);
    return fb;
  }
}

export type { OcrProvider, OcrInput, OcrOptions, OcrResult } from "./types.js";
export { OcrSpaceProvider, InMemoryDailyCounter } from "./ocrspace.js";
export type { OcrSpaceDailyCounter } from "./ocrspace.js";
export { TesseractOcrProvider } from "./tesseract.js";
export { GeminiOcrProvider } from "./gemini.js";
