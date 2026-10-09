import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiImageDescriptionProvider } from "../../providers/understanding/gemini-image-description.js";
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

function mockJson(status: number, body: unknown): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    })
  ) as unknown as typeof fetch;
}

describe("GeminiImageDescriptionProvider", () => {
  it("rejects missing API key at construction", () => {
    expect(() =>
      new GeminiImageDescriptionProvider("", "gemini-3.8-flash", makeClient())
    ).toThrow();
  });

  it("returns a caption on success and a stable revision hash", async () => {
    mockJson(200, {
      candidates: [{ content: { parts: [{ text: "A bookshelf with three hardcovers." }] } }]
    });
    const p = new GeminiImageDescriptionProvider("g-key", "gemini-3.8-flash", makeClient());
    const out = await p.describe({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg"
    });
    expect(out.caption).toBe("A bookshelf with three hardcovers.");
    expect(out.provider).toBe("gemini");
    expect(out.revision).toMatch(/^[a-f0-9]{16}$/);
  });

  it("throws EMPTY_RESPONSE when Gemini returns no text (does NOT invent a caption)", async () => {
    mockJson(200, { candidates: [] });
    const p = new GeminiImageDescriptionProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.describe({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  it("rejects oversized images", async () => {
    const p = new GeminiImageDescriptionProvider("g-key", "gemini-3.8-flash", makeClient());
    const big = new Uint8Array(11 * 1024 * 1024);
    await expect(
      p.describe({ bytes: big, mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
  });

  it("propagates INVALID_API_KEY without retry", async () => {
    mockJson(401, { error: "bad key" });
    const p = new GeminiImageDescriptionProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.describe({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" })
    ).rejects.toBeInstanceOf(ProviderError);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
