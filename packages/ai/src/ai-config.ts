/**
 * AI configuration.
 *
 * Reads the small, explicit set of environment variables that govern
 * which AI providers Mnemonics talks to. Centralised here so the
 * rest of the codebase never reads process.env directly.
 *
 * Hard rule: when AI_FREE_ONLY=true, the OpenAI provider is FORBIDDEN
 * regardless of OPENAI_API_KEY. This is the project-wide promise
 * documented in docs/free-ai-setup.md.
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
    provider: "gemini" | "heuristic";
    geminiApiKey?: string;
    geminiModel: string;
  };

  embeddings: {
    provider: "gemini" | "openai" | "noop";
    geminiApiKey?: string;
    geminiModel: string;
    geminiDimensions: number;
    openaiApiKey?: string;
    openaiModel: string;
  };

  ocr: {
    provider: "ocrspace" | "tesseract";
    ocrSpaceApiKey?: string;
    ocrSpaceDailySoftLimit: number;
    localFallback: boolean;
  };

  vision: {
    provider: "local";
    clipModel: string;
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
 * inconsistent (e.g. AI_FREE_ONLY=true with AI_TEXT_PROVIDER=openai,
 * which we do not currently support anyway).
 */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const freeOnly = readBool(env, "AI_FREE_ONLY", true);
  const demoMode =
    readBool(env, "DEMO_MODE", false) || readBool(env, "VITE_DEMO_MODE", false);

  const textProvider = (readString(env, "AI_TEXT_PROVIDER", "gemini") ?? "gemini") as
    | "gemini"
    | "heuristic";
  const embeddingProvider = (readString(env, "AI_EMBEDDING_PROVIDER", "gemini") ?? "gemini") as
    | "gemini"
    | "openai"
    | "noop";
  const ocrProvider = (readString(env, "OCR_PROVIDER", "ocrspace") ?? "ocrspace") as
    | "ocrspace"
    | "tesseract";
  const visionProvider = (readString(env, "VISUAL_EMBEDDING_PROVIDER", "local") ?? "local") as
    | "local";

  if (freeOnly) {
    if (embeddingProvider === "openai") {
      throw new Error(
        "AI_FREE_ONLY=true but AI_EMBEDDING_PROVIDER=openai. " +
          "Free mode forbids paid providers. Set AI_EMBEDDING_PROVIDER=gemini " +
          "or AI_FREE_ONLY=false."
      );
    }
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
    },
    embeddings: {
      provider: embeddingProvider,
      geminiApiKey: readString(env, "GEMINI_API_KEY"),
      geminiModel:
        readString(env, "GEMINI_EMBEDDING_MODEL", "gemini-embedding-001") ?? "gemini-embedding-001",
      geminiDimensions: readInt(env, "GEMINI_EMBEDDING_DIMENSIONS", 1536),
      openaiApiKey: readString(env, "OPENAI_API_KEY"),
      openaiModel:
        readString(env, "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small") ??
        "text-embedding-3-small",
    },
    ocr: {
      provider: ocrProvider,
      ocrSpaceApiKey: readString(env, "OCR_SPACE_API_KEY"),
      ocrSpaceDailySoftLimit: readInt(env, "OCR_SPACE_DAILY_SOFT_LIMIT", 450),
      localFallback: readBool(env, "OCR_LOCAL_FALLBACK", true),
    },
    vision: {
      provider: visionProvider,
      clipModel:
        readString(env, "VISUAL_EMBEDDING_MODEL", "Xenova/clip-vit-base-patch32") ??
        "Xenova/clip-vit-base-patch32",
    },
  };

  return config;
}
