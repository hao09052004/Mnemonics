import { describe, it, expect, vi, afterEach } from "vitest";
import { createAiService, formatSnapshot } from "../ai-service.js";
import { loadAiConfig } from "../ai-config.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createAiService", () => {
  it("builds a free-only service with gemini providers when key is set", async () => {
    const config = loadAiConfig({
      AI_FREE_ONLY: "true",
      GEMINI_API_KEY: "g-key",
      OCR_SPACE_API_KEY: "ocr-key",
      // Disable fallback so the test sees the bare primary providers
      AI_TEXT_FALLBACK: "false",
      AI_EMBEDDING_FALLBACK: "false",
    });
    const svc = await createAiService({ config });
    expect(svc.config.freeOnly).toBe(true);
    expect(svc.text.info().name).toBe("gemini");
    expect(svc.embeddings.info().name).toBe("gemini");
    expect(svc.primaryOcr.info().name).toBe("ocrspace");
    expect(svc.fallbackOcr.info().name).toBe("tesseract");
  });

  it("wraps text + embeddings in a FallingBack*Provider when fallback enabled", async () => {
    const config = loadAiConfig({
      AI_FREE_ONLY: "true",
      GEMINI_API_KEY: "g-key",
      OCR_SPACE_API_KEY: "ocr-key",
      // Defaults already have textFallback=true and embeddingsFallback=true
    });
    const svc = await createAiService({ config });
    expect(svc.text.info().name).toBe("gemini+ollama");
    // The embedding fallback is the LOCAL provider, so semantic search
    // survives a Gemini outage instead of dropping to lexical-only.
    expect(svc.embeddings.info().name).toBe("gemini+ollama");
    expect(svc.embeddings.info().dimensions).toBe(1024);
    // Health snapshot still surfaces the primary model in `model`
    expect(svc.text.info().model).toBe("gemini-3.8-flash");
  });

  it("falls back to tesseract when OCR.Space key is missing", async () => {
    const config = loadAiConfig({ AI_FREE_ONLY: "true", GEMINI_API_KEY: "g-key" });
    const svc = await createAiService({ config });
    expect(svc.primaryOcr.info().name).toBe("tesseract");
  });

  it("falls back to the LOCAL embedding provider when no Gemini key is set", async () => {
    const config = loadAiConfig({ AI_FREE_ONLY: "true" });
    const svc = await createAiService({ config });
    // A missing Gemini key must not mean "no semantic search": the
    // local bge-m3 model is the primary in that case.
    expect(svc.embeddings.info().name).toBe("ollama+noop");
    expect(svc.embeddings.info().model).toBe("bge-m3");
    expect(svc.embeddings.info().dimensions).toBe(1024);
  });

  it("uses noop embeddings only when the local width cannot match the column", async () => {
    // A non-1024 column means no local model can fill it safely, so the
    // provider degrades to noop (lexical-only) rather than padding.
    const config = loadAiConfig({
      AI_FREE_ONLY: "true",
      GEMINI_EMBEDDING_DIMENSIONS: "1536",
    });
    const svc = await createAiService({ config });
    expect(svc.embeddings.info().name).toBe("noop");
  });

  it("recognizeWithFallback chains primary→fallback", async () => {
    const config = loadAiConfig({ AI_FREE_ONLY: "true", GEMINI_API_KEY: "g-key" });
    // When OCR key is missing, primary IS already tesseract. We
    // assert the chain is wired but the actual call fails (no
    // tesseract.js installed in the unit test env). The error
    // carries the provider name so we can verify the chain.
    const svc = await createAiService({ config });
    await expect(
      svc.recognizeWithFallback({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
      })
    ).rejects.toMatchObject({ provider: "tesseract" });
  });

  it("health snapshot exposes config and provider names", async () => {
    const config = loadAiConfig({
      AI_FREE_ONLY: "true",
      GEMINI_API_KEY: "g-key",
      AI_TEXT_FALLBACK: "false",
      AI_EMBEDDING_FALLBACK: "false",
    });
    const svc = await createAiService({ config });
    const snap = await svc.health();
    expect(snap.config.freeOnly).toBe(true);
    expect(snap.config.text).toMatch(/^gemini:/);
    expect(snap.config.embeddings).toMatch(/^gemini:/);
  });
});

describe("formatSnapshot", () => {
  it("renders an OK line for each provider", () => {
    const s = formatSnapshot({
      config: {
        freeOnly: true,
        demoMode: false,
        text: "gemini:gemini-2.5-flash",
        embeddings: "gemini:gemini-embedding-001",
        ocr: "ocrspace:engine=2",
        visual: "clip-local:Xenova/clip-vit-base-patch32",
        understanding: "image=local:Xenova/vit-gpt2-image-captioning, tldr=deterministic:heuristic-v1"
      },
      textReady: true,
      embeddingsReady: true,
      ocrReady: true,
      visualReady: false,
      imageDescriptionReady: true,
      tldrReady: true,
      notes: [],
    });
    expect(s).toContain("Gemini text ........ OK");
    expect(s).toContain("FREE-ONLY");
  });
});

// Ensure no fetch leak across tests
vi.mock("node:fs/promises", () => ({}));
