import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiTextProvider } from "../../providers/text/gemini.js";
import { GeminiClient } from "../../gemini-client.js";
import { ProviderError } from "../../types.js";

const originalFetch = globalThis.fetch;

function makeClient(): GeminiClient {
  // Construct a client with very fast backoff so the existing
  // behaviour-driven tests (which only care about outcome, not
  // wall-clock) still complete quickly. `maxRetries` here is
  // total attempts.
  return new GeminiClient({
    timeoutMs: 5_000,
    maxRetries: 3,
    maxConcurrent: 4,
    rateLimitRpm: 10_000,
    sleep: async () => undefined
  });
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown; retryAfter?: string }>) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i += 1;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (r.retryAfter) headers["retry-after"] = r.retryAfter;
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("GeminiTextProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("rejects missing API key at construction", () => {
    expect(() => new GeminiTextProvider("", "gemini-2.5-flash", makeClient())).toThrowError(/apiKey/);
  });

  it("generateTags parses JSON array response", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: '["Design","User Research","async"]' }] } }],
        },
      },
    ]);
    const p = new GeminiTextProvider("g-key", "gemini-2.5-flash", makeClient());
    const tags = await p.generateTags("Some long content about design and research");
    expect(tags).toEqual(["design", "user-research", "async"]);
  });

  it("returns empty array on non-JSON response", async () => {
    mockFetchSequence([
      { status: 200, body: { candidates: [{ content: { parts: [{ text: "not json" }] } }] } },
    ]);
    const p = new GeminiTextProvider("g-key", "gemini-2.5-flash", makeClient());
    const tags = await p.generateTags("anything");
    expect(tags).toEqual([]);
  });

  it("fails open to heuristic when failOpen=true on transport error", async () => {
    mockFetchSequence([
      { status: 500, body: { error: "boom" } },
      { status: 500, body: { error: "boom" } },
      { status: 500, body: { error: "boom" } },
    ]);
    const p = new GeminiTextProvider("g-key", "gemini-2.5-flash", makeClient());
    const tags = await p.generateTags("design design design research", {
      failOpen: true
    });
    expect(tags).toContain("design");
  });

  it("throws on INVALID_API_KEY (no retry)", async () => {
    mockFetchSequence([{ status: 401, body: { error: "bad key" } }]);
    const p = new GeminiTextProvider("g-key", "gemini-2.5-flash", makeClient());
    await expect(p.generateTags("anything")).rejects.toBeInstanceOf(ProviderError);
  });
});
