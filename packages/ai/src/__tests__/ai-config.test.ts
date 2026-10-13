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
    // defaults: the text fallback is the deterministic heuristic
    // (always available, zero cost); the embedding fallback is noop
    // (lexical-only search) — the chain always terminates honestly.
    expect(c.text.textFallback).toBe(true);
    expect(c.embeddings.embeddingsFallback).toBe(true);
  });

  it("disables text fallback when AI_TEXT_FALLBACK=false", () => {
    const env: NodeJS.ProcessEnv = {
      AI_TEXT_FALLBACK: "false",
    };
    const c = loadAiConfig(env);
    expect(c.text.textFallback).toBe(false);
  });

  it("refuses non-local visual provider when AI_FREE_ONLY=true", () => {
    // "remote" is neither "local" nor "gemini". The config validator
    // refuses anything outside the allow-list so a future paid
    // provider cannot be enabled silently.
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "true",
      VISUAL_EMBEDDING_PROVIDER: "remote"
    };
    expect(() => loadAiConfig(env)).toThrowError(/visual providers|visual/);
  });

  it("refuses gemini visual when AI_FREE_ONLY=true and the model is not on the Free-Tier list", () => {
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "true",
      VISUAL_EMBEDDING_PROVIDER: "gemini",
      GEMINI_VISUAL_EMBEDDING_MODEL: "gemini-embedding-99-not-real"
    };
    expect(() => loadAiConfig(env)).toThrowError(/Free-Tier/);
  });

  it("accepts gemini-embedding-2 as a Free-Tier eligible visual model", () => {
    // The dev env opts in to the cloud visual provider. The model
    // must be on the verified-Free allow-list or the validator
    // refuses to boot.
    const env: NodeJS.ProcessEnv = {
      AI_FREE_ONLY: "true",
      VISUAL_EMBEDDING_PROVIDER: "gemini",
      GEMINI_VISUAL_EMBEDDING_MODEL: "gemini-embedding-2"
    };
    expect(() => loadAiConfig(env)).not.toThrow();
  });

  it("has no OpenAI fields at all — OpenAI was removed", () => {
    const c = loadAiConfig({ AI_EMBEDDING_PROVIDER: "gemini" });
    // A leftover OPENAI_API_KEY in the environment must be ignored.
    const withKey = loadAiConfig({ OPENAI_API_KEY: "sk-test" });
    expect(JSON.stringify(c.embeddings)).not.toContain("openai");
    expect(JSON.stringify(withKey.embeddings)).not.toContain("sk-test");
  });

  it("defaults embeddings to 1024-d for the cloud embedding model", () => {
    const c = loadAiConfig({});
    expect(c.embeddings.geminiDimensions).toBe(1024);
  });

  it("refuses unknown embedding provider", () => {
    expect(() =>
      loadAiConfig({ AI_EMBEDDING_PROVIDER: "openai" })
    ).toThrowError(/Unknown AI_EMBEDDING_PROVIDER/i);
  });

  it("respects OCR.Space daily soft limit override", () => {
    const env: NodeJS.ProcessEnv = {
      OCR_SPACE_DAILY_SOFT_LIMIT: "100",
    };
    const c = loadAiConfig(env);
    expect(c.ocr.ocrSpaceDailySoftLimit).toBe(100);
  });
});
