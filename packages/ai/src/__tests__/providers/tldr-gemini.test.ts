import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiTldrProvider } from "../../providers/understanding/gemini-tldr.js";
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

describe("GeminiTldrProvider", () => {
  it("rejects missing API key at construction", () => {
    expect(() => new GeminiTldrProvider("", "gemini-3.8-flash", makeClient())).toThrow();
  });

  it("returns a TLDR on success and tags the source as cloud_ai", async () => {
    mockJson(200, {
      candidates: [{ content: { parts: [{ text: "Article about sourdough baking." }] } }]
    });
    const p = new GeminiTldrProvider("g-key", "gemini-3.8-flash", makeClient());
    const out = await p.summarize({
      title: "Sourdough",
      rawText: "Mix 500g flour with 350g water…",
      type: "text"
    });
    expect(out.tldr).toBe("Article about sourdough baking.");
    expect(out.source).toBe("cloud_ai");
    expect(out.provider).toBe("gemini");
  });

  it("truncates output at the configured maxLength", async () => {
    mockJson(200, {
      candidates: [
        { content: { parts: [{ text: "x".repeat(500) }] } }
      ]
    });
    const p = new GeminiTldrProvider("g-key", "gemini-3.8-flash", makeClient(), {
      maxLength: 120
    });
    const out = await p.summarize({ title: "t", rawText: "x", type: "text" });
    expect(out.tldr.length).toBeLessThanOrEqual(120);
  });

  it("throws EMPTY_RESPONSE when Gemini returns no text (does NOT fall back silently)", async () => {
    mockJson(200, { candidates: [] });
    const p = new GeminiTldrProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.summarize({ title: "t", rawText: "x", type: "text" })
    ).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  it("propagates INVALID_API_KEY without retry", async () => {
    mockJson(401, { error: "bad key" });
    const p = new GeminiTldrProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.summarize({ title: "t", rawText: "x", type: "text" })
    ).rejects.toBeInstanceOf(ProviderError);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
