/**
 * AI configuration.
 *
 * Reads the small, explicit set of environment variables that govern
 * which AI providers Mnemonics talks to. Centralised here so the
 * rest of the codebase never reads process.env directly.
 *
 * Hard rule: when AI_FREE_ONLY=true, only free / local providers may
 * be called. Gemini's free tier and a local Ollama daemon both qualify;
 * the flag exists so a future paid provider cannot be enabled silently.
 *
 * Provider order for every AI capability: **Gemini first, local
 * (Ollama) second, OpenAI never.** OpenAI was removed from the codebase
 * entirely — there is no OPENAI_API_KEY and no openai provider, so a
 * ChatGPT key can no longer be selected by accident.
 */

export interface AiConfig {
  /**
   * True means: only free / local providers may be called. If a paid
   * provider is somehow selected, the AI service throws on
   * construction rather than silently calling the paid API.
   */
  freeOnly: boolean;

  /** True when running in demo mode. Mocks are only allowed here. */
  demoMode: boolean;

  text: {
    provider: "gemini" | "heuristic" | "ollama";
    geminiApiKey?: string;
    geminiModel: string;
    /**
     * Ollama local HTTP fallback (POST {ollamaBaseUrl}/api/chat).
     * Used only when `textFallback` is enabled and the primary
     * provider throws on a capture-time call.
     */
    ollamaBaseUrl?: string;
    ollamaTextModel: string;
    /** When true, fall back from the primary text provider to
     *  ollama on ProviderError. Default true (free mode). */
    textFallback: boolean;
  };

  embeddings: {
    provider: "gemini" | "ollama" | "noop";
    geminiApiKey?: string;
    geminiModel: string;
    geminiDimensions: number;
    /**
     * Local embedding fallback. Must be a model that emits exactly
     * `geminiDimensions` floats (bge-m3 is 1024-d) because both
     * providers write into the same `item_embeddings.embedding`
     * column — mixing widths would corrupt every similarity score.
     */
    ollamaBaseUrl?: string;
    ollamaEmbeddingModel: string;
    /**
     * Embedding-time fallback when the primary provider throws:
     * gemini -> local (Ollama) -> noop (lexical-only). The flag
     * exists so a deployment can opt out of the local hop.
     */
    embeddingsFallback: boolean;
  };

  ocr: {
    /**
     * OCR provider. Production target is "gemini" (multimodal
     * text extraction from images). The other two ("ocrspace",
     * "tesseract") are kept for offline development and as
     * deterministic fallbacks when Gemini is unavailable.
     */
    provider: "ocrspace" | "tesseract" | "gemini";
    ocrSpaceApiKey?: string;
    ocrSpaceDailySoftLimit: number;
    /** When true and OCR fails, retry with the next provider in the
     *  fallback chain. Default true. */
    localFallback: boolean;
  };

  /**
   * Force Ollama to run on CPU even when a GPU is available.
   * Needed when CUDA/cuDNN is broken on the host — Ollama attempts GPU
   * execution first and fails with a stack-buffer-overrun before
   * falling back to CPU automatically.
   */
  ollamaForceCpu: boolean;

  /**
   * Three distinct Gemini timeouts so a long RPM-pacer wait cannot
   * steal the request-execution budget:
   *
   *   geminiQueueWaitTimeoutMs — hard cap on how long `pace()`
   *     may sleep before a request is started.
   *   geminiRequestTimeoutMs   — per HTTP attempt, AbortController
   *     timeout.
   *   geminiTotalBudgetMs      — overall request-execution budget
   *     (excludes queue wait).
   *   geminiTldrTotalBudgetMs  — caller-side deadline for the full
   *     TLDR operation.
   */
  geminiQueueWaitTimeoutMs: number;
  geminiRequestTimeoutMs: number;
  geminiTotalBudgetMs: number;
  geminiTldrTotalBudgetMs: number;

  vision: {
    /**
     * Visual embedding provider. The text and visual spaces are
     * NEVER mixed, so the provider used here is independent of
     * `embeddings.provider`. "local" uses the local CLIP model
     * (development only); "gemini" calls Gemini's multimodal
     * embedding endpoint (see `GeminiVisualEmbeddingProvider`).
     */
    provider: "local" | "gemini";
    clipModel: string;
    /** Cloud visual model id (used when provider = "gemini"). */
    geminiVisualModel: string;
    /** Cloud visual embedding width. */
    geminiVisualDimensions: number;
  };

  understanding: {
    /**
     * Image-description provider. "local" is the offline
     * Transformers.js model. "gemini" is the production cloud
     * provider. Failures from "gemini" must not be silently
     * replaced by a fake caption.
     */
    imageDescriptionProvider: "local" | "gemini";
    /** Local image-description model. */
    localImageModel: string;
    /** Whether the local model may be downloaded on first use. */
    allowDownload: boolean;
    /**
     * TLDR provider.
     *   - "deterministic" — zero-cost, always available
     *   - "ollama" — local LLM upgrade
     *   - "gemini" — cloud TLDR via Gemini
     */
    tldrProvider: "deterministic" | "ollama" | "gemini";
    /** Hard ceiling for the TLDR string we persist. */
    tldrMaxLength: number;
    /** Below this raw content length the deterministic provider is
     *  used verbatim — no LLM call is attempted. */
    tldrMinTextLength: number;
  };
}

function readBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const v = env[name];
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

function readString(env: NodeJS.ProcessEnv, name: string, fallback?: string): string | undefined {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build the config. Throws if a configuration is internally
 * inconsistent (e.g. AI_FREE_ONLY=true with a non-local visual
 * provider).
 */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const freeOnly = readBool(env, "AI_FREE_ONLY", true);
  const demoMode =
    readBool(env, "DEMO_MODE", false) || readBool(env, "VITE_DEMO_MODE", false);

  const textProvider = (readString(env, "AI_TEXT_PROVIDER", "gemini") ?? "gemini") as
    | "gemini"
    | "heuristic"
    | "ollama";
  const embeddingProvider = (readString(env, "AI_EMBEDDING_PROVIDER", "gemini") ?? "gemini") as
    | "gemini"
    | "ollama"
    | "noop";
  const ocrProvider = (readString(env, "OCR_PROVIDER", "ocrspace") ?? "ocrspace") as
    | "ocrspace"
    | "tesseract"
    | "gemini";
  const visionProvider = (readString(env, "VISUAL_EMBEDDING_PROVIDER", "local") ?? "local") as
    | "local"
    | "gemini";
  const tldrProvider = (readString(env, "AI_TLDR_PROVIDER", "deterministic") ??
    "deterministic") as "deterministic" | "ollama" | "gemini";
  const imageDescriptionProvider = (readString(
    env,
    "AI_IMAGE_DESCRIPTION_PROVIDER",
    "local"
  ) ?? "local") as "local" | "gemini";

  if (freeOnly) {
    // Free mode forbids paid providers. Gemini Developer API keys
    // and Gemini embedding endpoints are eligible for the Free
    // Tier (subject to model availability per Google's docs);
    // any other future provider must be added to the allow-list
    // explicitly here.
    if (visionProvider !== "local" && visionProvider !== "gemini") {
      throw new Error(
        "AI_FREE_ONLY=true but VISUAL_EMBEDDING_PROVIDER is not 'local' or 'gemini'. " +
          "Free mode forbids paid visual providers."
      );
    }
    if (visionProvider === "gemini" && !isFreeTierEligibleVisualModel(env)) {
      throw new Error(
        "AI_FREE_ONLY=true and VISUAL_EMBEDDING_PROVIDER=gemini, but the configured " +
          "GEMINI_VISUAL_EMBEDDING_MODEL is not on the verified-Free list. " +
          "Either remove AI_FREE_ONLY, switch to VISUAL_EMBEDDING_PROVIDER=local, " +
          "or set GEMINI_VISUAL_EMBEDDING_MODEL to a Free-Tier eligible id."
      );
    }
  }

  const config: AiConfig = {
    freeOnly,
    demoMode,
    text: {
      provider: textProvider,
      geminiApiKey: readString(env, "GEMINI_API_KEY"),
      // Google has been deprecating the older Flash models for new
      // users ("model is no longer available to new users, please use
      // gemini-3.8-flash"). 3.x is a thinking model that spends
      // tokens on internal reasoning before emitting JSON, so callers
      // must set maxOutputTokens high enough (>=1024) to leave
      // headroom for both thinking + the actual array of tags.
      geminiModel: readString(env, "GEMINI_MODEL", "gemini-3.8-flash") ?? "gemini-3.8-flash",
      ollamaBaseUrl: readString(env, "OLLAMA_BASE_URL", "http://localhost:11434"),
      ollamaTextModel:
        readString(env, "OLLAMA_TEXT_MODEL", "llama3.2:3b") ?? "llama3.2:3b",
      textFallback: readBool(env, "AI_TEXT_FALLBACK", true)
    },
    embeddings: {
      provider: embeddingProvider,
      geminiApiKey: readString(env, "GEMINI_API_KEY"),
      geminiModel:
        readString(env, "GEMINI_EMBEDDING_MODEL", "gemini-embedding-001") ??
        "gemini-embedding-001",
      // Must stay in sync with item_embeddings.embedding — migration
      // 017 narrowed the column to 1024 so Gemini and the local model
      // share one embedding space.
      geminiDimensions: readInt(env, "GEMINI_EMBEDDING_DIMENSIONS", 1024),
      ollamaBaseUrl: readString(env, "OLLAMA_BASE_URL", "http://localhost:11434"),
      ollamaEmbeddingModel:
        readString(env, "OLLAMA_EMBEDDING_MODEL", "bge-m3") ?? "bge-m3",
      embeddingsFallback: readBool(env, "AI_EMBEDDING_FALLBACK", true)
    },
    ocr: {
      provider: ocrProvider,
      ocrSpaceApiKey: readString(env, "OCR_SPACE_API_KEY"),
      ocrSpaceDailySoftLimit: readInt(env, "OCR_SPACE_DAILY_SOFT_LIMIT", 450),
      localFallback: readBool(env, "OCR_LOCAL_FALLBACK", true)
    },
    ollamaForceCpu: readBool(env, "OLLAMA_FORCE_CPU", false),
    /**
     * Three distinct timeouts so a long RPM-pacer wait cannot
     * steal the request-execution budget. The pacer wait is
     * bounded at 60 s (one window of the RPM cap).
     *
     *   geminiQueueWaitTimeoutMs — hard cap on how long `pace()`
     *     may sleep before a request is started. Defaults to
     *     30 000 ms; 0 disables.
     *   geminiRequestTimeoutMs   — per HTTP attempt, AbortController
     *     timeout. Defaults to 20 000 ms.
     *   geminiTotalBudgetMs      — overall request-execution budget
     *     (excludes queue wait). Defaults to 60 000 ms.
     *   geminiTldrTotalBudgetMs  — caller-side deadline for the
     *     full TLDR operation. Defaults to 90 000 ms.
     */
    geminiQueueWaitTimeoutMs: readInt(env, "GEMINI_QUEUE_WAIT_TIMEOUT_MS", 30_000),
    geminiRequestTimeoutMs: readInt(env, "GEMINI_REQUEST_TIMEOUT_MS", 20_000),
    geminiTotalBudgetMs: readInt(env, "GEMINI_TOTAL_BUDGET_MS", 60_000),
    geminiTldrTotalBudgetMs: readInt(env, "GEMINI_TLDR_TOTAL_BUDGET_MS", 90_000),
    vision: {
      provider: visionProvider,
      clipModel:
        readString(env, "VISUAL_EMBEDDING_MODEL", "Xenova/clip-vit-base-patch32") ??
        "Xenova/clip-vit-base-patch32",
      geminiVisualModel:
        readString(env, "GEMINI_VISUAL_EMBEDDING_MODEL", "gemini-embedding-2") ??
        "gemini-embedding-2",
      geminiVisualDimensions: readInt(env, "GEMINI_VISUAL_EMBEDDING_DIMENSIONS", 512)
    },
    understanding: {
      imageDescriptionProvider,
      localImageModel:
        readString(env, "LOCAL_IMAGE_DESCRIPTION_MODEL", "Xenova/vit-gpt2-image-captioning") ??
        "Xenova/vit-gpt2-image-captioning",
      allowDownload: readBool(env, "AI_IMAGE_DESCRIPTION_ALLOW_DOWNLOAD", true),
      tldrProvider,
      tldrMaxLength: readInt(env, "TLDR_MAX_LENGTH", 240),
      tldrMinTextLength: readInt(env, "AI_TLDR_MIN_TEXT_LENGTH", 160)
    }
  };

  return config;
}

/**
 * Conservative allow-list of Gemini visual-embedding models
 * verified to be available on the Free Tier at the time of this
 * file's last review. Add new ids here ONLY after confirming the
 * model is on the Free Tier via the Google AI Studio model
 * catalog — silent drift to a paid model is a billing incident.
 */
const FREE_TIER_VISUAL_MODELS = new Set<string>([
  // "gemini-embedding-2" is the Gemini multimodal-embedding model
  // used for visual search. The dev environment opts in here so the
  // boot-time validator does not refuse the cloud visual provider.
  // Operator note: Google AI Studio's Free Tier eligibility is
  // model-specific and changes without notice. Before this id goes
  // to production, confirm against the current model catalog at
  // https://ai.google.dev/gemini-api/docs/models and remove the
  // entry if the model has moved to a paid tier.
  "gemini-embedding-2"
]);

function isFreeTierEligibleVisualModel(env: NodeJS.ProcessEnv): boolean {
  const m = readString(env, "GEMINI_VISUAL_EMBEDDING_MODEL", "");
  if (!m) return false;
  return FREE_TIER_VISUAL_MODELS.has(m);
}
