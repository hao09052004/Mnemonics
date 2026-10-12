/**
 * Per-user daily AI quota.
 *
 * A public beta of a personal-knowledge product MUST protect
 * itself from one user uploading hundreds of PDFs and exhausting
 * the shared Gemini Free-Tier quota. The {@link UserAiQuota}
 * counter enforces a per-user daily cap on the number of
 * provider-acknowledged AI calls. Calls beyond the cap throw a
 * non-retryable ProviderError with code `RATE_LIMITED`, and the
 * memory is preserved (the item becomes `ready` with whatever
 * enrichment already happened). The daily counter is reset at
 * UTC midnight, which matches the Gemini Developer API's
 * reset window for free-tier daily quotas.
 *
 * The quota is enforced at the moment a Gemini call STARTS — the
 * counter increments even if the call ultimately fails, so a
 * burst of 429s cannot burn the budget. Callers that need a
 * "would this user be allowed to call?" check (for example, the
 * upload route) can use {@link UserAiQuota.wouldAllow} before
 * queueing the work.
 *
 * Scope: this is an in-process counter. A multi-instance
 * deployment needs a shared store (e.g. a `user_ai_quotas` table
 * in Postgres, or a Redis counter). The interface is deliberately
 * small so the store can be swapped without changing the providers.
 */

import { ProviderError } from "./types.js";

/** UTC date string in `YYYY-MM-DD` form. */
function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface UserAiQuotaOptions {
  /** Per-user daily soft cap. Default 100. */
  dailyLimit?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * Thread-safe (Node single-thread) per-user daily counter.
 *
 * `record()` is the entry point used by the provider layer: it
 * increments the counter and throws if the limit is exceeded. The
 * counter is keyed by `${userId}|${utcDate}` so a new day starts
 * with a fresh budget automatically.
 */
export class UserAiQuota {
  private readonly dailyLimit: number;
  private readonly now: () => Date;
  /** `${userId}|${utcDate}` → count. */
  private readonly counts = new Map<string, { day: string; n: number }>();

  constructor(opts: UserAiQuotaOptions = {}) {
    this.dailyLimit = Math.max(1, opts.dailyLimit ?? 100);
    this.now = opts.now ?? ((): Date => new Date());
  }

  /**
   * The configured per-user daily limit. Exposed for the health
   * snapshot.
   */
  limit(): number {
    return this.dailyLimit;
  }

  /**
   * Current count for the user today. Useful for the health
   * snapshot and for tests; not a check — call {@link record} to
   * both check and increment.
   */
  count(userId: string): number {
    const key = userId;
    const today = utcDateKey(this.now());
    const entry = this.counts.get(key);
    if (!entry || entry.day !== today) return 0;
    return entry.n;
  }

  /**
   * Returns true if the user is under their daily limit. Does
   * NOT increment.
   */
  wouldAllow(userId: string): boolean {
    return this.count(userId) < this.dailyLimit;
  }

  /**
   * Increment the counter for the user. Throws a non-retryable
   * ProviderError if the user is at or over the daily limit so
   * the calling worker can mark the item `ready` and stop
   * hammering Gemini.
   */
  record(userId: string, task: string): void {
    const today = utcDateKey(this.now());
    const key = userId;
    const entry = this.counts.get(key);
    if (!entry || entry.day !== today) {
      this.counts.set(key, { day: today, n: 1 });
      return;
    }
    if (entry.n >= this.dailyLimit) {
      throw new ProviderError({
        message: `User ${userId} reached the daily AI quota (${this.dailyLimit}) on task '${task}'. The memory is preserved; the AI enrichment is skipped and the item becomes 'ready' with whatever enrichment already completed.`,
        code: "RATE_LIMITED",
        provider: "user-quota",
        retryable: false
      });
    }
    entry.n += 1;
  }

  /**
   * Reset the counter for a user. Intended for tests and for an
   * operator override after a manual quota bump.
   */
  reset(userId: string): void {
    this.counts.delete(userId);
  }
}

/**
 * Module-level default quota. Configured by the AI service at
 * boot from env. The instance is intentionally process-wide so
 * a single burst from multiple call sites (text + embedding +
 * OCR + image + TLDR) shares one budget.
 */
let defaultQuota: UserAiQuota | null = null;

export function getDefaultUserAiQuota(): UserAiQuota {
  if (!defaultQuota) {
    const env = process.env;
    const limit = Number.parseInt(env.AI_USER_DAILY_LIMIT ?? "", 10);
    defaultQuota = new UserAiQuota({ dailyLimit: Number.isFinite(limit) ? limit : 100 });
  }
  return defaultQuota;
}

export function setDefaultUserAiQuota(quota: UserAiQuota | null): void {
  defaultQuota = quota;
}
