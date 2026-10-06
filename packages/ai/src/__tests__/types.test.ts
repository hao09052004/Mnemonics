import { describe, it, expect } from "vitest";
import { contentHash, truncate, ProviderError } from "../types.js";

describe("contentHash", () => {
  it("is deterministic and 64 hex chars (sha256)", async () => {
    const a = await contentHash(["title", "body", null, undefined]);
    const b = await contentHash(["title", "body"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when content differs", async () => {
    const a = await contentHash(["title", "body"]);
    const b = await contentHash(["title", "BODY"]);
    expect(a).not.toBe(b);
  });
});

describe("truncate", () => {
  it("returns input unchanged when short enough", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates to maxChars", () => {
    expect(truncate("a".repeat(20), 5)).toBe("aaaaa");
  });

  it("default cap is 8000 chars", () => {
    const big = "a".repeat(10_000);
    expect(truncate(big).length).toBe(8000);
  });
});

describe("ProviderError", () => {
  it("carries code, provider, retryable, retryAfterMs", () => {
    const e = new ProviderError({
      message: "rate-limited",
      code: "RATE_LIMITED",
      provider: "gemini",
      retryable: true,
      retryAfterMs: 1000,
    });
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.provider).toBe("gemini");
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(1000);
    expect(e.name).toBe("ProviderError");
  });
});
