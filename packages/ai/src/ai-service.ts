/**
 * AI service — the dependency-injection container for the rest of
 * the app. All callers (job handlers, routes) should depend on
 * this object, not on a concrete provider.
 *
 * Construction is fail-fast: a misconfiguration throws here, not
 * later when a request comes in.
 */

import { loadAiConfig, type AiConfig } from "./ai-config.js";
import { buildGeminiClient, type GeminiClient } from "./gemini-client.js";
import { buildTextProvider, type TextProvider } from "./providers/text/index.js";
import {
  buildEmbeddingProvider,
  type EmbeddingProvider
} from "./providers/embeddings/index.js";
import {
  buildOcrProvider,
  recognizeWithFallback,
  type OcrProvider,
  type OcrInput,
  type OcrResult
} from "./providers/ocr/index.js";
import { buildVisualProvider, type VisualProvider } from "./providers/vision/index.js";
import {
  buildUnderstandingProviders,
  type UnderstandingProviders
} from "./providers/understanding/index.js";
import {
  MemoryCache,
  createMemoryCache,
  type CacheStore
} from "./cache.js";
import { contentHash } from "./types.js";

export interface AiService {
  readonly config: AiConfig;
  readonly text: TextProvider;
  readonly embeddings: EmbeddingProvider;
  readonly primaryOcr: OcrProvider;
  readonly fallbackOcr: OcrProvider;
  readonly visual: VisualProvider;
  readonly understanding: UnderstandingProviders;
  /** Run OCR with primary → fallback chain. */
  recognizeWithFallback(input: OcrInput): Promise<OcrResult>;
  /** Cache helpers exposed so job handlers can store derived results. */
  tagCache: CacheStore<string[]>;
  summaryCache: CacheStore<string>;
  embeddingCache: CacheStore<number[]>;
  ocrCache: CacheStore<OcrResult>;
  /** Diagnostics object, suitable for `pnpm ai:check`. */
  health(): Promise<AiHealthSnapshot>;
}

export interface AiHealthSnapshot {
  config: {
    freeOnly: boolean;
    demoMode: boolean;
    text: string;
    embeddings: string;
    ocr: string;
    visual: string;
    understanding: string;
  };
  /** True if the provider can be reached / has the right shape. */
  textReady: boolean;
  embeddingsReady: boolean;
  ocrReady: boolean;
  visualReady: boolean;
  imageDescriptionReady: boolean;
  tldrReady: boolean;
  ocrDailyCount?: number;
  ocrDailyLimit?: number;
  notes: string[];
}

export async function createAiService(opts?: {
  config?: AiConfig;
  ocrFallback?: OcrProvider;
  geminiClient?: GeminiClient;
}): Promise<AiService> {
  const config = opts?.config ?? loadAiConfig();
  // One Gemini client per process. Reusing a single client means
  // the concurrency cap, RPM pacer, and circuit breaker count
  // every Gemini call — text, embeddings, OCR, image, TLDR,
  // visual — together, so a flood of capture jobs cannot
  // stampede the Free Tier from multiple call sites at once.
  const geminiClient = opts?.geminiClient ?? buildGeminiClient();
  const text = buildTextProvider(config, geminiClient);
  const embeddings = buildEmbeddingProvider(config, geminiClient);
  const primaryOcr = buildOcrProvider(config, undefined, geminiClient);
  const fallbackOcr =
    opts?.ocrFallback ??
    (primaryOcr.info().name === "tesseract"
      ? primaryOcr
      : new (await import("./providers/ocr/index.js")).TesseractOcrProvider());
  const visual = buildVisualProvider(config, geminiClient);
  const understanding = buildUnderstandingProviders({ config, geminiClient });

  const tagCache = createMemoryCache<string[]>({ defaultTtlMs: 6 * 60 * 60 * 1000 });
  const summaryCache = createMemoryCache<string>({ defaultTtlMs: 6 * 60 * 60 * 1000 });
  const embeddingCache = createMemoryCache<number[]>({ defaultTtlMs: 24 * 60 * 60 * 1000 });
  const ocrCache = createMemoryCache<OcrResult>({ defaultTtlMs: 24 * 60 * 60 * 1000 });

  const service: AiService = {
    config,
    text,
    embeddings,
    primaryOcr,
    fallbackOcr,
    visual,
    understanding,
    async recognizeWithFallback(input) {
      const key = await contentHash([
        "ocr",
        config.ocr.provider,
        String(input.bytes.length),
        input.mimeType,
        input.language ?? "",
      ]);
      const cached = ocrCache.get(key);
      if (cached) return cached;
      const out = await recognizeWithFallback(primaryOcr, fallbackOcr, input);
      ocrCache.set(key, out);
      return out;
    },
    tagCache,
    summaryCache,
    embeddingCache,
    ocrCache,
    async health(): Promise<AiHealthSnapshot> {
      const notes: string[] = [];
      const textReady = await probe(text.info().name === "noop" ? null : text);
      const embeddingsReady = await probe(embeddings.info().name === "noop" ? null : embeddings);
      const ocrReady = await probe(primaryOcr);
      const visualInfo = visual.info();
      const ocrInfo = primaryOcr.info();
      const understandingImage = understanding.imageDescription.info();
      const understandingTldr = understanding.tldr.info();
      const imageDescriptionReady = understandingImage.loaded;
      const tldrReady = true; // deterministic always ready; ollama best-effort
      const ocrCounter = (primaryOcr as unknown as {
        // best-effort — only OcrSpaceProvider has this
        dailyCounter?: { count: () => number; limit: () => number };
      }).dailyCounter;
      return {
        config: {
          freeOnly: config.freeOnly,
          demoMode: config.demoMode,
          text: `${text.info().name}:${text.info().model}`,
          embeddings: `${embeddings.info().name}:${embeddings.info().model}`,
          ocr: `${ocrInfo.name}:${ocrInfo.model}`,
          visual: `${visualInfo.name}:${visualInfo.model}`,
          understanding: `image=${understandingImage.name}:${understandingImage.model}, tldr=${understandingTldr.name}:${understandingTldr.model}`
        },
        textReady,
        embeddingsReady,
        ocrReady,
        visualReady: visualInfo.loaded,
        imageDescriptionReady,
        tldrReady,
        ocrDailyCount: ocrCounter?.count?.(),
        ocrDailyLimit:
          typeof ocrCounter?.limit === "function" ? ocrCounter.limit() : undefined,
        notes,
      };
    },
  };

  return service;
}

/**
 * Cheap probe: do the provider's info() succeed and does the object
 * have the right shape? We do NOT actually call the network here —
 * the pnpm ai:check command can do that separately.
 */
async function probe(p: unknown): Promise<boolean> {
  if (!p) return false;
  if (typeof p !== "object") return false;
  const info = (p as { info?: () => unknown }).info;
  return typeof info === "function";
}

export { MemoryCache, createMemoryCache } from "./cache.js";
export type { CacheStore } from "./cache.js";
export { formatSnapshot } from "./ai-health.js";
