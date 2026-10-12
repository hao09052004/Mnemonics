import type { Pool, PoolClient } from 'pg';

export interface ThrottleDecision {
  locked: boolean;
  retryAfterSeconds: number;
}

export interface Throttle {
  check(email: string): Promise<ThrottleDecision>;
  recordFailure(email: string): Promise<ThrottleDecision>;
  reset(email: string): Promise<void>;
}

type Executor = Pool | PoolClient;

function rows(dec: { locked: boolean; retry_after_seconds: number }): ThrottleDecision {
  return { locked: !!dec?.locked, retryAfterSeconds: Number(dec?.retry_after_seconds ?? 0) || 0 };
}

export function createThrottle(executor: Executor): Throttle {
  return {
    async check(email) {
      const r = await executor.query<{ locked: boolean; retry_after_seconds: number }>(
        `SELECT locked, retry_after_seconds FROM public.is_email_locked($1)`,
        [email]
      );
      return rows(r.rows[0] ?? { locked: false, retry_after_seconds: 0 });
    },
    async recordFailure(email) {
      const r = await executor.query<{ locked: boolean; retry_after_seconds: number }>(
        `SELECT locked, retry_after_seconds FROM public.record_failed_attempt($1)`,
        [email]
      );
      return rows(r.rows[0] ?? { locked: false, retry_after_seconds: 0 });
    },
    async reset(email) {
      await executor.query(`SELECT public.reset_attempts($1)`, [email]);
    }
  };
}

/**
 * In-memory throttle used by tests; mirrors createThrottle's contract.
 */
export function createMemoryThrottle(): Throttle {
  const store = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
  const WINDOW_MS = 15 * 60_000;
  const LOCK_MS = 15 * 60_000;
  const MAX = 5;

  function now() { return Date.now(); }

  function fresh(email: string) {
    const row = store.get(email);
    if (!row) return { count: 0, firstAt: now(), lockedUntil: 0 };
    if (row.firstAt + WINDOW_MS < now()) return { count: 0, firstAt: now(), lockedUntil: 0 };
    return row;
  }

  return {
    async check(email) {
      const r = fresh(email);
      if (r.lockedUntil > now()) {
        return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((r.lockedUntil - now()) / 1000)) };
      }
      return { locked: false, retryAfterSeconds: 0 };
    },
    async recordFailure(email) {
      const r = fresh(email);
      r.count = (r.count || 0) + 1;
      r.firstAt = r.firstAt || now();
      let locked = false;
      let retryAfter = 0;
      if (r.count >= MAX) {
        r.lockedUntil = now() + LOCK_MS;
        locked = true;
        retryAfter = Math.ceil(LOCK_MS / 1000);
      }
      store.set(email, r);
      return { locked, retryAfterSeconds: retryAfter };
    },
    async reset(email) {
      store.delete(email);
    }
  };
}
