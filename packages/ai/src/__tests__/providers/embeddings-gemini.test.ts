import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiEmbeddingProvider } from "../../providers/embeddings/gemini.js";
import { ProviderError } from "../../types.js";

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown, retryAfter?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (retryAfter) headers["retry-after"] = retryAfter;
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function vec(n: number, fill = 0.1) {
  return new Array(n).fill(fill);
}

describe("GeminiEmbeddingProvider", () => {
  it("rejects missing key", () => {
    expect(() => new GeminiEmbeddingProvider("", "gemini-embedding-001", 1536)).toThrow();
  });

  it("embedOne returns first batch element", async () => {
    mockFetch(200, {
      embeddings: [{ values: vec(1536, 0.1) }],
    });
    const p = new GeminiEmbeddingProvider("g-key", "gemini-embedding-001", 1536);
    const out = await p.embedOne("hello");
    expect(out).toHaveLength(1536);
  });

  it("embedMany handles batch", async () => {
    mockFetch(200, {
      embeddings: [{ values: vec(1536, 0.1) }, { values: vec(1536, 0.2) }],
    });
    const p = new GeminiEmbeddingProvider("g-key", "gemini-embedding-001", 1536);
    const out = await p.embedMany(["a", "b"]);
    expect(out).toHaveLength(2);
    expect(out[1][0]).toBe(0.2);
  });

  it("rejects count mismatch as INVALID_RESPONSE", async () => {
    mockFetch(200, { embeddings: [{ values: vec(1536) }] });
    const p = new GeminiEmbeddingProvider("g-key", "gemini-embedding-001", 1536);
    await expect(p.embedMany(["a", "b"])).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("401 throws INVALID_API_KEY (no retry)", async () => {
    mockFetch(401, { error: "bad key" });
    const p = new GeminiEmbeddingProvider("g-key", "gemini-embedding-001", 1536);
    await expect(p.embedOne("x")).rejects.toBeInstanceOf(ProviderError);
  });

  it("429 eventually throws ProviderError after retries", async () => {
    mockFetch(429, { error: "quota" });
    const p = new GeminiEmbeddingProvider("g-key", "gemini-embedding-001", 1536);
    await expect(p.embedOne("x", { timeoutMs: 1000 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      provider: "gemini",
    });
  });
});
