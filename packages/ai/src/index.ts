/**
 * @mnemonics/ai — provider surface for Mnemonics AI features.
 *
 * This package is the single place that knows about Gemini, OpenAI,
 * OCR.Space, Tesseract, and CLIP. The rest of the application talks
 * to the interfaces, never to a concrete provider.
 *
 * Public entry points:
 *  - createAiService() — DI container; constructed once at boot
 *  - loadAiConfig() — env → typed config (with AI_FREE_ONLY guard)
 *  - snapshot() / deepProbe() / formatSnapshot() — for pnpm ai:check
 *  - provider factories for tests and one-off use
 *
 * See docs/ai-architecture.md for the full architecture and
 * docs/free-ai-setup.md for the env setup walkthrough.
 */

export type { AiConfig } from "./ai-config.js";
export { loadAiConfig } from "./ai-config.js";

export type { AiService, AiHealthSnapshot } from "./ai-service.js";
export { createAiService } from "./ai-service.js";

export { snapshot, deepProbe } from "./ai-health.js";
export { formatSnapshot } from "./ai-health.js";

export {
  ProviderError,
  contentHash,
  truncate,
  type ProviderFailureCode,
} from "./types.js";

export {
  createMemoryCache,
  MemoryCache,
  type CacheStore,
} from "./cache.js";

export type { TextProvider, TextProviderInfo, TextGenerationOptions } from "./providers/text/index.js";
export { buildTextProvider, GeminiTextProvider, HeuristicTextProvider } from "./providers/text/index.js";

export type { EmbeddingProvider, EmbeddingProviderInfo, EmbeddingOptions } from "./providers/embeddings/index.js";
export { buildEmbeddingProvider, GeminiEmbeddingProvider, OpenAIEmbeddingProvider, NoopEmbeddingProvider } from "./providers/embeddings/index.js";

export type { OcrProvider, OcrInput, OcrOptions, OcrResult } from "./providers/ocr/index.js";
export { buildOcrProvider, recognizeWithFallback, OcrSpaceProvider, TesseractOcrProvider, InMemoryDailyCounter } from "./providers/ocr/index.js";
export type { OcrSpaceDailyCounter } from "./providers/ocr/index.js";

export type { VisualProvider, VisualInput, VisualEmbeddingResult, VisualProviderInfo } from "./providers/vision/index.js";
export { buildVisualProvider, ClipLocalProvider } from "./providers/vision/index.js";
