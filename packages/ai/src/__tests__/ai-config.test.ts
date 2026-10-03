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
    expect(c.text.geminiModel).toBe("gemini-2.5-flash");
    expect(c.embeddings.provider).toBe("gemini");
    expect(c.embeddings.geminiModel).toBe("gemini-embedding-001");
    expect(c.embeddings.geminiDimensions).toBe(1536);
    expect(c.ocr.provider).toBe("ocrspace");
    expect(c.ocr.ocrSpaceDailySoftLimit).toBe(450);
    expect(c.ocr.localFallback).toBe(true);
    expect(c.vision.provider).toBe("local");
    expect(c.vision.clipModel).toBe("Xenova/clip-vit-base-patch32");
  });

  it("refuses to construct an OpenAI provider when AI_FREE_ONLY=true", () => {
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "true",
      AI_EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    };
    expect(() => loadAiConfig(env)).toThrowError(/AI_FREE_ONLY=true/);
  });

  it("refuses non-local visual provider when AI_FREE_ONLY=true", () => {
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "true",
      VISUAL_EMBEDDING_PROVIDER: "remote",
    };
    expect(() => loadAiConfig(env)).toThrowError(/visual providers/);
  });

  it("allows openai embedding provider when AI_FREE_ONLY=false", () => {
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "false",
      AI_EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    };
    const c = loadAiConfig(env);
    expect(c.embeddings.provider).toBe("openai");
    expect(c.embeddings.openaiApiKey).toBe("sk-test");
  });

  it("respects OCR.Space daily soft limit override", () => {
    const env: NodeJS.ProcessEnv = {
      OCR_SPACE_DAILY_SOFT_LIMIT: "100",
    };
    const c = loadAiConfig(env);
    expect(c.ocr.ocrSpaceDailySoftLimit).toBe(100);
  });
});
