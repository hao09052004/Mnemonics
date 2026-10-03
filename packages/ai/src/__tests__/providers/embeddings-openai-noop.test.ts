import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIEmbeddingProvider } from "../../providers/embeddings/openai.js";
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

describe("OpenAIEmbeddingProvider (legacy)", () => {
  it("rejects missing key", () => {
    expect(() => new OpenAIEmbeddingProvider("", "text-embedding-3-small", 1536)).toThrow();
  });

  it("embedOne parses the response", async () => {
    mockFetch(200, {
      data: [{ embedding: new Array(1536).fill(0.1) }],
    });
    const p = new OpenAIEmbeddingProvider("sk-test", "text-embedding-3-small", 1536);
    const out = await p.embedOne("x");
    expect(out).toHaveLength(1536);
  });

  it("401 throws INVALID_API_KEY", async () => {
    mockFetch(401, { error: { message: "bad" } });
    const p = new OpenAIEmbeddingProvider("sk-test", "text-embedding-3-small", 1536);
    await expect(p.embedOne("x")).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });
});

describe("NoopEmbeddingProvider", () => {
  it("refuses to produce vectors", async () => {
    const p = new NoopEmbeddingProvider(1536);
    await expect(p.embedOne("x")).rejects.toBeInstanceOf(ProviderError);
    await expect(p.embedMany(["a", "b"])).rejects.toBeInstanceOf(ProviderError);
  });

  it("info reports dimensions", () => {
    const p = new NoopEmbeddingProvider(1536);
    expect(p.info()).toEqual({ name: "noop", model: "none", dimensions: 1536 });
  });
});
