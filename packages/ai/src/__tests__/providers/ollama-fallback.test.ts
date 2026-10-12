/**
 * Tests for OllamaTextProvider and the FallingBack*Provider wrappers.
 * Network calls are stubbed via globalThis.fetch so the tests are
 * hermetic.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaTextProvider } from "../../providers/text/ollama.js";
import { FallingBackTextProvider } from "../../providers/text/fallback.js";
import { FallingBackEmbeddingProvider } from "../../providers/embeddings/fallback.js";
import { HeuristicTextProvider } from "../../providers/text/heuristic.js";
import { NoopEmbeddingProvider } from "../../providers/embeddings/noop.js";
import { ProviderError } from "../../types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("OllamaTextProvider", () => {
  it("returns parsed JSON tags on a 200 response", async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toContain("/api/generate");
      return new Response(
        JSON.stringify({ response: '["recipes", "sourdough", "baking"]' }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "llama3.2:3b");
    const tags = await p.generateTags("Bake bread with sourdough starter");
    expect(tags).toEqual(["recipes", "sourdough", "baking"]);
  });

  it("strips markdown fences before parsing JSON", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ response: "```json\n[\"tag-1\", \"tag-2\", \"tag-3\"]\n```" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "llama3.2:3b");
    const tags = await p.generateTags("anything");
    expect(tags).toEqual(["tag-1", "tag-2", "tag-3"]);
  });

  it("throws a clear 404 when the model is not pulled", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("not found", { status: 404 });
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "nope");
    await expect(p.generateTags("anything")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      provider: "ollama",
    });
  });

  it("retries on 5xx then throws", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      n += 1;
      return new Response("server error", { status: 503 });
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "llama3.2:3b");
    await expect(p.generateTags("anything", { timeoutMs: 500 })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      provider: "ollama",
    });
    expect(n).toBeGreaterThanOrEqual(2);
  }, 10_000);

  it("falls back to heuristic when failOpen=true and transport errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "llama3.2:3b");
    const tags = await p.generateTags("Bake bread with sourdough starter", {
      failOpen: true,
      timeoutMs: 1000,
    });
    // Heuristic extraction keeps the top-frequency tokens; we only
    // assert the call returned a non-empty array (no throw).
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
  }, 10_000);

  it("probe returns true when the daemon is up and the model is present", async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toContain("/api/tags");
      return new Response(
        JSON.stringify({ models: [{ name: "llama3.2:3b" }] }),
        { status: 200 }
      );
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "llama3.2:3b");
    expect(await p.probe()).toBe(true);
  });

  it("probe returns true even when the model is missing (logs only)", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "nope");
    expect(await p.probe()).toBe(true);
  });

  it("probe returns false on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    const p = new OllamaTextProvider("http://localhost:11434", "x");
    expect(await p.probe()).toBe(false);
  });
});

describe("FallingBackTextProvider", () => {
  it("returns the primary result on success", async () => {
    const primary = new HeuristicTextProvider();
    const fallback = new HeuristicTextProvider();
    const wrapped = new FallingBackTextProvider(primary, fallback);
    const tags = await wrapped.generateTags("hello world hello");
    expect(Array.isArray(tags)).toBe(true);
  });

  it("falls through to the fallback when the primary throws", async () => {
    const primaryErr = new ProviderError({
      message: "synthetic",
      code: "PROVIDER_UNAVAILABLE",
      provider: "synthetic-primary",
      retryable: true,
    });
    const primary = {
      generateTags: async () => {
        throw primaryErr;
      },
      summarize: async () => {
        throw primaryErr;
      },
      info: () => ({ name: "synthetic-primary", model: "x" }),
    };
    const fallback = new HeuristicTextProvider();
    const wrapped = new FallingBackTextProvider(primary as any, fallback);
    const tags = await wrapped.generateTags("hello world hello");
    expect(Array.isArray(tags)).toBe(true);
  });

  it("rethrows a non-ProviderError from the primary", async () => {
    const primary = {
      generateTags: async () => {
        throw new TypeError("boom");
      },
      summarize: async () => "",
      info: () => ({ name: "synthetic", model: "x" }),
    };
    const fallback = new HeuristicTextProvider();
    const wrapped = new FallingBackTextProvider(primary as any, fallback);
    await expect(wrapped.generateTags("hi")).rejects.toBeInstanceOf(TypeError);
  });

  it("surfaces the fallback's error when both providers throw", async () => {
    const primary = {
      generateTags: async () => {
        throw new ProviderError({
          message: "primary down",
          code: "PROVIDER_UNAVAILABLE",
          provider: "p",
          retryable: true,
        });
      },
      summarize: async () => "",
      info: () => ({ name: "p", model: "x" }),
    };
    const fallbackErr = new ProviderError({
      message: "fallback also down",
      code: "TIMEOUT",
      provider: "f",
      retryable: true,
    });
    const fallback = {
      generateTags: async () => {
        throw fallbackErr;
      },
      summarize: async () => "",
      info: () => ({ name: "f", model: "y" }),
    };
    const wrapped = new FallingBackTextProvider(primary as any, fallback as any);
    await expect(wrapped.generateTags("hi")).rejects.toBe(fallbackErr);
  });

  it("invokes the onFallback hook with the primary error and the kind", async () => {
    const primaryErr = new ProviderError({
      message: "synthetic",
      code: "RATE_LIMITED",
      provider: "p",
      retryable: true,
    });
    const primary = {
      generateTags: async () => {
        throw primaryErr;
      },
      summarize: async () => "",
      info: () => ({ name: "p", model: "x" }),
    };
    const fallback = new HeuristicTextProvider();
    const onFallback = vi.fn();
    const wrapped = new FallingBackTextProvider(primary as any, fallback, onFallback);
    await wrapped.generateTags("hi");
    expect(onFallback).toHaveBeenCalledWith(primaryErr, "tags");
  });
});

describe("FallingBackEmbeddingProvider", () => {
  it("returns the primary result on success", async () => {
    const primary = {
      embedOne: async () => [0.1, 0.2, 0.3],
      embedMany: async () => [[0.1, 0.2, 0.3]],
      info: () => ({ name: "p", model: "x", dimensions: 3 }),
    };
    const fallback = new NoopEmbeddingProvider(3);
    const wrapped = new FallingBackEmbeddingProvider(primary as any, fallback);
    const v = await wrapped.embedOne("hi");
    expect(v).toEqual([0.1, 0.2, 0.3]);
  });

  it("falls through to the noop fallback when the primary throws", async () => {
    const primary = {
      embedOne: async () => {
        throw new ProviderError({
          message: "down",
          code: "PROVIDER_UNAVAILABLE",
          provider: "p",
          retryable: true,
        });
      },
      embedMany: async () => [[]],
      info: () => ({ name: "p", model: "x", dimensions: 3 }),
    };
    const fallback = new NoopEmbeddingProvider(3);
    const wrapped = new FallingBackEmbeddingProvider(primary as any, fallback);
    await expect(wrapped.embedOne("hi")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      provider: "noop",
    });
  });

  it("info() advertises the primary's dimensions", () => {
    const primary = {
      embedOne: async () => [],
      embedMany: async () => [[]],
      info: () => ({ name: "p", model: "x", dimensions: 1536 }),
    };
    const fallback = new NoopEmbeddingProvider(1536);
    const wrapped = new FallingBackEmbeddingProvider(primary as any, fallback);
    expect(wrapped.info()).toMatchObject({ name: "p+noop", dimensions: 1536 });
  });
});
