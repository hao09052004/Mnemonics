import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UserAiQuota, setDefaultUserAiQuota } from "../user-quota.js";

describe("UserAiQuota", () => {
  let now: Date;
  beforeEach(() => {
    now = new Date("2026-01-15T10:00:00Z");
    setDefaultUserAiQuota(null);
  });
  afterEach(() => {
    setDefaultUserAiQuota(null);
    vi.useRealTimers();
  });

  it("starts at zero for a new user", () => {
    const q = new UserAiQuota({ dailyLimit: 5, now: () => now });
    expect(q.count("u1")).toBe(0);
    expect(q.wouldAllow("u1")).toBe(true);
  });

  it("increments on record and refuses at the cap", () => {
    const q = new UserAiQuota({ dailyLimit: 3, now: () => now });
    q.record("u1", "tag");
    q.record("u1", "tag");
    q.record("u1", "tag");
    expect(() => q.record("u1", "tag")).toThrowError(/daily AI quota/);
    expect(q.count("u1")).toBe(3);
  });

  it("resets at UTC midnight", () => {
    let day = 0;
    const q = new UserAiQuota({
      dailyLimit: 2,
      now: () => new Date(`2026-01-15T23:59:5${day++}Z`)
    });
    q.record("u1", "tag");
    q.record("u1", "tag");
    expect(() => q.record("u1", "tag")).toThrow();
    // Move the clock past UTC midnight.
    q.reset("u1");
    expect(q.count("u1")).toBe(0);
    q.record("u1", "tag");
    expect(q.count("u1")).toBe(1);
  });

  it("is per-user: one user hitting the cap does not affect another", () => {
    const q = new UserAiQuota({ dailyLimit: 1, now: () => now });
    q.record("u1", "tag");
    expect(() => q.record("u1", "tag")).toThrow();
    expect(q.wouldAllow("u2")).toBe(true);
    q.record("u2", "tag");
    expect(q.count("u2")).toBe(1);
  });

  it("reset() clears the counter for a user", () => {
    const q = new UserAiQuota({ dailyLimit: 5, now: () => now });
    q.record("u1", "tag");
    q.record("u1", "tag");
    q.reset("u1");
    expect(q.count("u1")).toBe(0);
  });
});
