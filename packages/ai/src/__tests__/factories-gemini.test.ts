import { describe, it, expect } from "vitest";
import { buildOcrProvider } from "../providers/ocr/index.js";
import { buildVisualProvider } from "../providers/vision/index.js";
import { buildUnderstandingProviders } from "../providers/understanding/index.js";
import { loadAiConfig } from "../ai-config.js";
import { GeminiClient } from "../gemini-client.js";

const client = new GeminiClient({ sleep: async () => undefined });

describe("provider factories (gemini-only production config)", () => {
  it("buildOcrProvider returns GeminiOcrProvider when OCR_PROVIDER=gemini", () => {
    const cfg = loadAiConfig({
      AI_FREE_ONLY: "true",
      OCR_PROVIDER: "gemini",
      GEMINI_API_KEY: "g-test",
      GEMINI_MODEL: "gemini-3.8-flash"
    });
    const p = buildOcrProvider(cfg, undefined, client);
    expect(p.info().name).toBe("gemini");
  });

  it("buildOcrProvider refuses Gemini without an API key", () => {
    const cfg = loadAiConfig({
      AI_FREE_ONLY: "true",
      OCR_PROVIDER: "gemini"
    });
    expect(() => buildOcrProvider(cfg, undefined, client)).toThrowError(/GEMINI_API_KEY/);
  });

  it("buildVisualProvider returns GeminiVisualEmbeddingProvider when VISUAL_EMBEDDING_PROVIDER=gemini", () => {
    // We have to disable AI_FREE_ONLY to construct the factory, because
    // the model is not on the verified-Free list. The factory itself
    // does not enforce the Free-Tier rule — the config validator does,
    // so this is testing the factory in isolation.
    const cfg = loadAiConfig({
      AI_FREE_ONLY: "false",
      VISUAL_EMBEDDING_PROVIDER: "gemini",
      GEMINI_API_KEY: "g-test",
      GEMINI_VISUAL_EMBEDDING_MODEL: "gemini-embedding-2",
      GEMINI_VISUAL_EMBEDDING_DIMENSIONS: "512"
    });
    const p = buildVisualProvider(cfg, client);
    expect(p.info().name).toBe("gemini-visual");
    expect(p.info().dimensions).toBe(512);
  });

  it("buildUnderstandingProviders wires GeminiTldrProvider when AI_TLDR_PROVIDER=gemini", () => {
    const cfg = loadAiConfig({
      AI_FREE_ONLY: "true",
      AI_TLDR_PROVIDER: "gemini",
      GEMINI_API_KEY: "g-test",
      AI_IMAGE_DESCRIPTION_PROVIDER: "local"
    });
    const u = buildUnderstandingProviders({ config: cfg, geminiClient: client });
    expect(u.tldr.info().name).toBe("gemini");
  });

  it("buildUnderstandingProviders wires GeminiImageDescriptionProvider when configured", () => {
    const cfg = loadAiConfig({
      AI_FREE_ONLY: "true",
      AI_IMAGE_DESCRIPTION_PROVIDER: "gemini",
      GEMINI_API_KEY: "g-test",
      AI_TLDR_PROVIDER: "deterministic"
    });
    const u = buildUnderstandingProviders({ config: cfg, geminiClient: client });
    expect(u.imageDescription.info().name).toBe("gemini");
  });
});
