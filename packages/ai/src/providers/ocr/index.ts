/**
 * Provider factory for OCR.
 *
 * Always returns the primary provider selected by config. The
 * primary→fallback chaining (ocrspace → tesseract) is performed by
 * the caller (the OCR job handler) using the `recognizeWithFallback`
 * helper below, so the provider objects stay stateless and easy to
 * test.
 */

import type { AiConfig } from "../../ai-config.js";
import type { OcrProvider, OcrInput, OcrOptions, OcrResult } from "./types.js";
import {
  OcrSpaceProvider,
  InMemoryDailyCounter,
  type OcrSpaceDailyCounter,
} from "./ocrspace.js";
import { TesseractOcrProvider } from "./tesseract.js";

export function buildOcrProvider(config: AiConfig, counter?: OcrSpaceDailyCounter): OcrProvider {
  switch (config.ocr.provider) {
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
