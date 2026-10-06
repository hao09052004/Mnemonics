/**
 * Tesseract.js local OCR provider.
 *
 * This is the always-on fallback: no API key, no network, no quota.
 * Used when:
 *  - OCR_PROVIDER=tesseract, or
 *  - OCR_SPACE_DAILY_SOFT_LIMIT was hit, or
 *  - OCR.Space returned a 4xx/5xx we cannot retry out of.
 *
 * The `tesseract.js` dependency is loaded lazily (dynamic import) so
 * tests that don't exercise this provider don't pay the import cost
 * and so the build does not fail in environments that don't have
 * tesseract.js installed.
 *
 * Note: tesseract.js is intentionally NOT a hard dependency of
 * @mnemonics/ai because it ships a ~30MB WASM binary. Install it
 * only when you intend to use the local fallback:
 *   pnpm --filter @mnemonics/ai add tesseract.js
 */

import { ProviderError } from "../../types.js";
import type { OcrInput, OcrOptions, OcrProvider, OcrResult } from "./types.js";

interface TesseractWorkerLike {
  load: () => Promise<void>;
  loadLanguage: (lang: string) => Promise<void>;
  initialize: (lang: string) => Promise<void>;
  recognize: (image: Uint8Array | Buffer) => Promise<{ data: { text: string; confidence: number; language: string } }>;
  terminate: () => Promise<void>;
}

let cachedWorkerPromise: Promise<TesseractWorkerLike> | null = null;

async function getWorker(lang: string): Promise<TesseractWorkerLike> {
  // Dynamic import — tesseract.js is optional and only installed when
  // the local OCR fallback is actually used. We cannot add it to
  // @mnemonics/ai as a hard dependency because it ships a ~30MB
  // WASM binary; consumers opt in via:
  //   pnpm --filter @mnemonics/ai add tesseract.js
  let createWorker: ((opts?: unknown) => Promise<TesseractWorkerLike>) | undefined;
  try {
    // @ts-expect-error optional peer-style dep, may be absent
    const mod = (await import("tesseract.js")) as unknown as {
      createWorker?: (opts?: unknown) => Promise<TesseractWorkerLike>;
    };
    createWorker = mod.createWorker;
  } catch {
    throw new ProviderError({
      message:
        "tesseract.js is not installed. Install it with `pnpm --filter @mnemonics/ai add tesseract.js` " +
        "or switch OCR_PROVIDER=ocrspace with a valid OCR_SPACE_API_KEY.",
      code: "PROVIDER_UNAVAILABLE",
      provider: "tesseract",
      retryable: false,
    });
  }
  if (!createWorker) {
    throw new ProviderError({
      message: "tesseract.js did not export createWorker",
      code: "PROVIDER_UNAVAILABLE",
      provider: "tesseract",
      retryable: false,
    });
  }
  if (!cachedWorkerPromise) {
    cachedWorkerPromise = (async () => {
      const w = await createWorker!();
      await w.load();
      await w.loadLanguage(lang);
      await w.initialize(lang);
      return w;
    })();
  }
  return cachedWorkerPromise;
}

export class TesseractOcrProvider implements OcrProvider {
  constructor(private readonly defaultLang = "eng") {}

  info(): { name: string; model: string } {
    return { name: "tesseract", model: "tesseract.js-default" };
  }

  async recognize(input: OcrInput, _opts?: OcrOptions): Promise<OcrResult> {
    const lang = input.language ?? this.defaultLang;
    try {
      const worker = await getWorker(lang);
      const result = await worker.recognize(input.bytes);
      return {
        text: (result.data.text ?? "").trim(),
        engine: "tesseract",
        confidence: (result.data.confidence ?? 0) / 100,
        language: result.data.language ?? lang,
      };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError({
        message: err instanceof Error ? err.message : String(err),
        code: "PROVIDER_UNAVAILABLE",
        provider: "tesseract",
        retryable: false,
        cause: err,
      });
    }
  }
}
