import { describe, it, expect, vi, afterEach } from "vitest";
import { GeminiOcrProvider } from "../../providers/ocr/gemini.js";
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

function mockFetch(impl: (body: unknown) => Response | Promise<Response>): void {
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null;
    return impl(body);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GeminiOcrProvider", () => {
  it("rejects missing API key at construction", () => {
    expect(() => new GeminiOcrProvider("", "gemini-3.8-flash", makeClient())).toThrow();
  });

  it("rejects empty bytes with INVALID_RESPONSE", async () => {
    const p = new GeminiOcrProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.recognize({ bytes: new Uint8Array([]), mimeType: "image/png" })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects non-image MIME", async () => {
    const p = new GeminiOcrProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.recognize({ bytes: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects oversized images", async () => {
    const p = new GeminiOcrProvider("g-key", "gemini-3.8-flash", makeClient());
    const big = new Uint8Array(11 * 1024 * 1024);
    await expect(
      p.recognize({ bytes: big, mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
  });

  it("returns extracted text from a successful 200", async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: "Hello\nWorld" }] } }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const p = new GeminiOcrProvider("g-key", "gemini-3.8-flash", makeClient());
    const out = await p.recognize({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png"
    });
    expect(out.text).toBe("Hello\nWorld");
    expect(out.engine).toBe("gemini");
  });

  it("returns empty text (not an error) when Gemini produces no candidates", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const p = new GeminiOcrProvider("g-key", "gemini-3.8-flash", makeClient());
    const out = await p.recognize({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png"
    });
    expect(out.text).toBe("");
    expect(out.engine).toBe("gemini");
  });

  it("propagates INVALID_API_KEY without retry", async () => {
    mockFetch(() => new Response("bad key", { status: 401 }));
    const p = new GeminiOcrProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.recognize({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" })
    ).rejects.toBeInstanceOf(ProviderError);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it("retries 5xx and ultimately throws PROVIDER_UNAVAILABLE", async () => {
    mockFetch(() => new Response("down", { status: 500 }));
    const p = new GeminiOcrProvider("g-key", "gemini-3.8-flash", makeClient());
    await expect(
      p.recognize({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" })
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(1);
  });
});
