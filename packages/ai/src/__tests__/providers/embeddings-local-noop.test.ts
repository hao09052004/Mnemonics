/**
 * Embedding provider tests for the local (Ollama) fallback and the
 * noop floor. OpenAI is no longer a provider — see the note in
 * `providers/embeddings/index.ts`.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OllamaEmbeddingProvider,
  LOCAL_EMBEDDING_DIMENSIONS,
} from "../../providers/embeddings/ollama.js";
import { NoopEmbeddingProvider } from "../../providers/embeddings/noop.js";
import { ProviderError } from "../../types.js";

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OllamaEmbeddingProvider", () => {
  it("rejects a baseUrl or model that is empty", () => {
    expect(() => new OllamaEmbeddingProvider("", "bge-m3")).toThrow();
    expect(() => new OllamaEmbeddingProvider("http://localhost:11434", "")).toThrow();
  });

  it("refuses a width that does not match the pgvector column", () => {
    // 1536 is the OLD column width; accepting it would corrupt search.
    expect(() => new OllamaEmbeddingProvider("http://localhost:11434", "bge-m3", 1536)).toThrow(
      /must be 1024/
    );
  });

  it("embedOne returns a 1024-d vector from /api/embed", async () => {
    mockFetch(200, { embeddings: [new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0.1)] });
    const p = new OllamaEmbeddingProvider("http://localhost:11434", "bge-m3");
    const out = await p.embedOne("x");
    expect(out).toHaveLength(LOCAL_EMBEDDING_DIMENSIONS);
  });

  it("embedMany batches in one call", async () => {
    const vec = new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0.2);
    mockFetch(200, { embeddings: [vec, vec] });
    const p = new OllamaEmbeddingProvider("http://localhost:11434", "bge-m3");
    const out = await p.embedMany(["a", "b"]);
    expect(out).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a 768-d model instead of padding it (regression: zero-pad corrupts ranking)", async () => {
    // nomic-embed-text is 768-d. Padding it to 1024 would rank on the
    // zero tail, so the provider must fail loudly.
    mockFetch(200, { embeddings: [new Array(768).fill(0.1)] });
    const p = new OllamaEmbeddingProvider("http://localhost:11434", "nomic-embed-text");
    await expect(p.embedOne("x")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(p.embedOne("x")).rejects.toThrowError(/768-d vectors/);
  });

  it("rejects a mismatched vector count", async () => {
    mockFetch(200, { embeddings: [new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0.1)] });
    const p = new OllamaEmbeddingProvider("http://localhost:11434", "bge-m3");
    await expect(p.embedMany(["a", "b"])).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("404 on a missing model throws INVALID_RESPONSE with a pull hint", async () => {
    mockFetch(404, { error: "model not found" });
    const p = new OllamaEmbeddingProvider("http://localhost:11434", "bge-m3");
    await expect(p.embedOne("x")).rejects.toThrowError(/ollama pull bge-m3/);
  });

  it("5xx is retryable", async () => {
    mockFetch(503, { error: "unavailable" });
    const p = new OllamaEmbeddingProvider("http://localhost:11434", "bge-m3");
    await expect(p.embedOne("x")).rejects.toMatchObject({ retryable: true });
  });

  it("info reports the local model and 1024 dimensions", () => {
    const p = new OllamaEmbeddingProvider("http://localhost:11434", "bge-m3");
    expect(p.info()).toEqual({ name: "ollama", model: "bge-m3", dimensions: 1024 });
  });
});

describe("NoopEmbeddingProvider", () => {
  it("refuses to produce vectors", async () => {
    const p = new NoopEmbeddingProvider(1024);
    await expect(p.embedOne("x")).rejects.toBeInstanceOf(ProviderError);
    await expect(p.embedMany(["a", "b"])).rejects.toBeInstanceOf(ProviderError);
  });

  it("info reports dimensions", () => {
    const p = new NoopEmbeddingProvider(1024);
    expect(p.info()).toEqual({ name: "noop", model: "none", dimensions: 1024 });
  });
});
