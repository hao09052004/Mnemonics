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
    provider: "ocrspace" | "tesseract";
    ocrSpaceApiKey?: string;
    ocrSpaceDailySoftLimit: number;
    localFallback: boolean;
  };

  /**
   * Force Ollama to run on CPU even when a GPU is available.
   * Needed when CUDA/cuDNN is broken on the host — Ollama attempts GPU
   * execution first and fails with a stack-buffer-overrun before
   * falling back to CPU automatically.
   */
  ollamaForceCpu: boolean;

  vision: {
    provider: "local";
    clipModel: string;
  };

  understanding: {
    /** Local image-description provider. Always on. */
    localImageModel: string;
    /** Whether the local model may be downloaded on first use. */
    allowDownload: boolean;
    /** "deterministic" (default) or "ollama" (local LLM upgrade). */
    tldrProvider: "deterministic" | "ollama";
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
    | "tesseract";
  const visionProvider = (readString(env, "VISUAL_EMBEDDING_PROVIDER", "local") ?? "local") as
    | "local";
  const tldrProvider = (readString(env, "AI_TLDR_PROVIDER", "deterministic") ?? "deterministic") as
    | "deterministic"
    | "ollama";

  if (freeOnly) {
    if (visionProvider !== "local") {
      throw new Error(
        "AI_FREE_ONLY=true but VISUAL_EMBEDDING_PROVIDER is not 'local'. " +
          "Free mode forbids paid visual providers."
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
      textFallback: readBool(env, "AI_TEXT_FALLBACK", true),
    },
    embeddings: {
      provider: embeddingProvider,
      geminiApiKey: readString(env, "GEMINI_API_KEY"),
      geminiModel:
        readString(env, "GEMINI_EMBEDDING_MODEL", "gemini-embedding-001") ?? "gemini-embedding-001",
      // Must stay in sync with item_embeddings.embedding — migration
      // 017 narrowed the column to 1024 so Gemini and the local model
      // share one embedding space.
      geminiDimensions: readInt(env, "GEMINI_EMBEDDING_DIMENSIONS", 1024),
      ollamaBaseUrl: readString(env, "OLLAMA_BASE_URL", "http://localhost:11434"),
      ollamaEmbeddingModel:
        readString(env, "OLLAMA_EMBEDDING_MODEL", "bge-m3") ?? "bge-m3",
      embeddingsFallback: readBool(env, "AI_EMBEDDING_FALLBACK", true),
    },
    ocr: {
      provider: ocrProvider,
      ocrSpaceApiKey: readString(env, "OCR_SPACE_API_KEY"),
      ocrSpaceDailySoftLimit: readInt(env, "OCR_SPACE_DAILY_SOFT_LIMIT", 450),
      localFallback: readBool(env, "OCR_LOCAL_FALLBACK", true),
    },
    ollamaForceCpu: readBool(env, "OLLAMA_FORCE_CPU", false),
    vision: {
      provider: visionProvider,
      clipModel:
        readString(env, "VISUAL_EMBEDDING_MODEL", "Xenova/clip-vit-base-patch32") ??
        "Xenova/clip-vit-base-patch32",
    },
    understanding: {
      localImageModel:
        readString(env, "LOCAL_IMAGE_DESCRIPTION_MODEL", "Xenova/vit-gpt2-image-captioning") ??
        "Xenova/vit-gpt2-image-captioning",
      allowDownload: readBool(env, "AI_IMAGE_DESCRIPTION_ALLOW_DOWNLOAD", true),
      tldrProvider,
      tldrMaxLength: readInt(env, "TLDR_MAX_LENGTH", 240),
      tldrMinTextLength: readInt(env, "AI_TLDR_MIN_TEXT_LENGTH", 160)
    },
  };

  return config;
}
