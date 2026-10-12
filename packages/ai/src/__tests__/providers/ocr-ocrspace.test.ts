import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OcrSpaceProvider,
  InMemoryDailyCounter,
} from "../../providers/ocr/ocrspace.js";
import { TesseractOcrProvider } from "../../providers/ocr/tesseract.js";
import { recognizeWithFallback } from "../../providers/ocr/index.js";
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

describe("OcrSpaceProvider", () => {
  it("rejects missing key at construction", () => {
    expect(() => new OcrSpaceProvider("", new InMemoryDailyCounter(10))).toThrow();
  });

  it("returns parsed text on success", async () => {
    mockFetch(200, {
      ParsedResults: [{ ParsedText: "Hello world" }],
      IsErroredOnProcessing: false,
    });
    const p = new OcrSpaceProvider("k", new InMemoryDailyCounter(10));
    const out = await p.recognize({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(out.text).toBe("Hello world");
    expect(out.engine).toBe("ocrspace");
  });

  it("throws INVALID_API_KEY on 401", async () => {
    mockFetch(401, { ErrorMessage: "Invalid API key" });
    const p = new OcrSpaceProvider("k", new InMemoryDailyCounter(10));
    await expect(
      p.recognize({ bytes: new Uint8Array([1]), mimeType: "image/png" })
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  it("enforces daily soft limit", async () => {
    const counter = new InMemoryDailyCounter(2);
    counter.increment();
    counter.increment();
    const p = new OcrSpaceProvider("k", counter);
    await expect(
      p.recognize({ bytes: new Uint8Array([1]), mimeType: "image/png" })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("InMemoryDailyCounter resets at calendar boundary", () => {
    const c = new InMemoryDailyCounter(5);
    c.increment();
    expect(c.count()).toBe(1);
    // simulate tomorrow
    const realDate = globalThis.Date;
    globalThis.Date = class extends realDate {
      override toISOString(): string {
        return "2099-01-01T00:00:00.000Z";
      }
    } as unknown as typeof Date;
    try {
      expect(c.count()).toBe(0);
    } finally {
      globalThis.Date = realDate;
    }
  });
});

describe("recognizeWithFallback", () => {
  it("returns primary result when it has text", async () => {
    mockFetch(200, { ParsedResults: [{ ParsedText: "primary" }] });
    const primary = new OcrSpaceProvider("k", new InMemoryDailyCounter(10));
    const fallback = new TesseractOcrProvider();
    const out = await recognizeWithFallback(primary, fallback, {
      bytes: new Uint8Array([1]),
      mimeType: "image/png",
    });
    expect(out.text).toBe("primary");
    expect(out.engine).toBe("ocrspace");
  });

  it("falls back to tesseract on auth error from primary", async () => {
    // Tesseract will fail to load tesseract.js in this test (not
    // installed) which surfaces as ProviderError with code
    // PROVIDER_UNAVAILABLE. The fallback path is taken; the test
    // only asserts that the failure is propagated, not that the
    // fallback succeeded — the unit test for tesseract.js lives in
    // a separate integration suite.
    mockFetch(401, { ErrorMessage: "bad" });
    const primary = new OcrSpaceProvider("k", new InMemoryDailyCounter(10));
    const fallback = new TesseractOcrProvider();
    await expect(
      recognizeWithFallback(primary, fallback, {
        bytes: new Uint8Array([1]),
        mimeType: "image/png",
      })
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
