import { describe, it, expect } from "vitest";
import { createMemoryCache } from "../cache.js";

describe("MemoryCache", () => {
  it("stores and returns values", () => {
    const c = createMemoryCache<number>({ defaultTtlMs: 1000 });
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
  });

  it("expires entries after TTL", async () => {
    const c = createMemoryCache<number>({ defaultTtlMs: 30 });
    c.set("a", 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(c.get("a")).toBeUndefined();
  });

  it("evicts oldest entries when over maxEntries", () => {
    const c = createMemoryCache<number>({ defaultTtlMs: 60_000, maxEntries: 3 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.set("d", 4);
    expect(c.has("a")).toBe(false);
    expect(c.has("d")).toBe(true);
    expect(c.size()).toBe(3);
  });

  it("has() returns false after deletion", () => {
    const c = createMemoryCache<number>();
    c.set("a", 1);
    c.delete("a");
    expect(c.has("a")).toBe(false);
  });
});
