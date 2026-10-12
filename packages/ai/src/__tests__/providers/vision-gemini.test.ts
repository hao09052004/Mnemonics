import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiVisualEmbeddingProvider } from "../../providers/vision/gemini.js";
import { GeminiClient } from "../../gemini-client.js";
import { ProviderError } from "../../types.js";

const originalFetch = globalThis.fetch;

function makeClient(): GeminiClient {
  return new GeminiClient({
    timeoutMs: 5_000,
    maxRetries: 2,
    maxConcurrent: 4,
    rateLimitRpm: 10_000,
    sleep: async () => undefined
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function vec(n: number, fill = 0.1): number[] {
  return new Array(n).fill(fill);
}

function mockJson(status: number, body: unknown): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  ) as unknown as typeof fetch;
}

describe("GeminiVisualEmbeddingProvider", () => {
  it("rejects missing API key at construction", () => {
    expect(
      () => new GeminiVisualEmbeddingProvider("", "gemini-embedding-2", 512, makeClient())
    ).toThrow();
  });

  it("returns a 512-d vector on success", async () => {
    mockJson(200, { embedding: { values: vec(512, 0.2) } });
    const p = new GeminiVisualEmbeddingProvider(
      "g-key",
      "gemini-embedding-2",
      512,
      makeClient()
    );
    const out = await p.embed({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg"
    });
    expect(out.vector).toHaveLength(512);
    expect(out.model).toBe("gemini-embedding-2");
  });

  it("rejects mismatched-dimension vectors instead of silently truncating", async () => {
    // Model returned 256 floats, config says 512. The provider
    // must surface this so the caller can refuse to write a
    // wrong-width vector to the visual-embedding table.
    mockJson(200, { embedding: { values: vec(256) } });
    const p = new GeminiVisualEmbeddingProvider(
      "g-key",
      "gemini-embedding-2",
      512,
      makeClient()
    );
    await expect(
      p.embed({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects non-image MIME", async () => {
    const p = new GeminiVisualEmbeddingProvider(
      "g-key",
      "gemini-embedding-2",
      512,
      makeClient()
    );
    await expect(
      p.embed({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("propagates INVALID_API_KEY without retry", async () => {
    mockJson(401, { error: "bad key" });
    const p = new GeminiVisualEmbeddingProvider(
      "g-key",
      "gemini-embedding-2",
      512,
      makeClient()
    );
    await expect(
      p.embed({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" })
    ).rejects.toBeInstanceOf(ProviderError);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
