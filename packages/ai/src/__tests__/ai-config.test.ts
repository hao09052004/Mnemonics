import { describe, it, expect } from "vitest";
import { loadAiConfig } from "../ai-config.js";

describe("loadAiConfig", () => {
  it("defaults to free-only + gemini text + gemini embeddings + ocrspace", () => {
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "true",
      GEMINI_API_KEY: "g-test",
    };
    const c = loadAiConfig(env);
    expect(c.freeOnly).toBe(true);
    expect(c.text.provider).toBe("gemini");
    expect(c.text.geminiModel).toBe("gemini-3.8-flash");
    expect(c.embeddings.provider).toBe("gemini");
    expect(c.embeddings.geminiModel).toBe("gemini-embedding-001");
    expect(c.embeddings.geminiDimensions).toBe(1024);
    expect(c.ocr.provider).toBe("ocrspace");
    expect(c.ocr.ocrSpaceDailySoftLimit).toBe(450);
    expect(c.ocr.localFallback).toBe(true);
    expect(c.vision.provider).toBe("local");
    expect(c.vision.clipModel).toBe("Xenova/clip-vit-base-patch32");
    // New fallback knobs default to the conservative free-mode
    // defaults: local Ollama text fallback is opt-in by env var
    // but always wired in code; the embedding fallback is the LOCAL
    // provider (a real 1024-d semantic search), terminating at noop
    // only when the local model is unusable.
    expect(c.text.textFallback).toBe(true);
    expect(c.text.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(c.text.ollamaTextModel).toBe("llama3.2:3b");
    expect(c.embeddings.embeddingsFallback).toBe(true);
    expect(c.embeddings.ollamaEmbeddingModel).toBe("bge-m3");
  });

  it("disables text fallback when AI_TEXT_FALLBACK=false", () => {
    const env: NodeJS.ProcessEnv = {
      AI_TEXT_FALLBACK: "false",
    };
    const c = loadAiConfig(env);
    expect(c.text.textFallback).toBe(false);
  });

  it("refuses non-local visual provider when AI_FREE_ONLY=true", () => {
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "true",
      VISUAL_EMBEDDING_PROVIDER: "remote",
    };
    expect(() => loadAiConfig(env)).toThrowError(/visual providers/);
  });

  it("has no OpenAI fields at all — OpenAI was removed", () => {
    const c = loadAiConfig({ AI_EMBEDDING_PROVIDER: "gemini" });
    // A leftover OPENAI_API_KEY in the environment must be ignored.
    const withKey = loadAiConfig({ OPENAI_API_KEY: "sk-test" });
    expect(JSON.stringify(c.embeddings)).not.toContain("openai");
    expect(JSON.stringify(withKey.embeddings)).not.toContain("sk-test");
  });

  it("defaults embeddings to 1024-d so Gemini and the local model share one column", () => {
    const c = loadAiConfig({});
    expect(c.embeddings.geminiDimensions).toBe(1024);
    expect(c.embeddings.ollamaEmbeddingModel).toBe("bge-m3");
  });

  it("accepts the local ollama embedding provider", () => {
    const c = loadAiConfig({
      AI_EMBEDDING_PROVIDER: "ollama",
      OLLAMA_BASE_URL: "http://localhost:11434",
      OLLAMA_EMBEDDING_MODEL: "bge-m3",
    });
    expect(c.embeddings.provider).toBe("ollama");
    expect(c.embeddings.ollamaEmbeddingModel).toBe("bge-m3");
  });

  it("respects OCR.Space daily soft limit override", () => {
    const env: NodeJS.ProcessEnv = {
      OCR_SPACE_DAILY_SOFT_LIMIT: "100",
    };
    const c = loadAiConfig(env);
    expect(c.ocr.ocrSpaceDailySoftLimit).toBe(100);
  });
});
