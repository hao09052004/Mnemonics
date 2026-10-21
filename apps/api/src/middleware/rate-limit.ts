/**
 * Rate Limiting Middleware
 *
 * Simple in-memory rate limiter. For production, use Redis.
 */

import type { Request, Response, NextFunction } from 'express';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyGenerator?: (req: Request) => string;
  message?: string;
  /**
   * Decides whether this request is actually guarded by the limiter.
   *
   * Limiters are mounted on a shared '/api/v1' prefix so the underlying
   * routers can keep their own absolute paths. That means the middleware
   * also runs for routes it does not own, and every one of those requests
   * used to consume the budget. Returning false makes the limiter a pass
   * -through for routes outside its scope. Defaults to counting everything.
   */
  shouldLimit?: (req: Request) => boolean;
  store?: RateLimitStore;
}

export interface RequestRecord {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number, now: number): Promise<RequestRecord> | RequestRecord;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly records = new Map<string, RequestRecord>();

  increment(key: string, windowMs: number, now: number): RequestRecord {
    if (Math.random() < 0.01) {
      this.cleanupExpired(now);
    }
    let record = this.records.get(key);
    if (!record || record.resetAt < now) {
      record = { count: 1, resetAt: now + windowMs };
      this.records.set(key, record);
    } else {
      record.count += 1;
    }
    return record;
  }

  private cleanupExpired(now: number): void {
    for (const [k, r] of this.records.entries()) {
      if (r.resetAt < now) this.records.delete(k);
    }
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly pool: { query: (sql: string, params?: unknown[]) => Promise<any> }) {}

  async increment(key: string, windowMs: number, now: number): Promise<RequestRecord> {
    const resetAt = now + windowMs;
    try {
      const res = await this.pool.query(
        `INSERT INTO rate_limit_counters (key, reset_at, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (key)
         DO UPDATE SET
           count = CASE WHEN rate_limit_counters.reset_at < $3 THEN 1 ELSE rate_limit_counters.count + 1 END,
           reset_at = CASE WHEN rate_limit_counters.reset_at < $3 THEN $2 ELSE rate_limit_counters.reset_at END
         RETURNING count, reset_at`,
        [key, resetAt, now]
      );
      const row = res.rows[0];
      return {
        count: Number.parseInt(row?.count ?? '1', 10),
        resetAt: Number.parseInt(row?.reset_at ?? String(resetAt), 10)
      };
    } catch {
      return { count: 1, resetAt };
    }
  }
}

const defaultStores: Map<string, MemoryRateLimitStore> = new Map();

/**
 * Create rate limiter middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => {
      const user = (req as any).user;
      if (user?.id) return `user:${user.id}`;
      return `ip:${req.ip || 'unknown'}`;
    },
    message = 'Too many requests, please try again later.',
    shouldLimit = () => true,
    store
  } = config;

  const storeKey = `${windowMs}-${maxRequests}`;

  if (!defaultStores.has(storeKey)) {
    defaultStores.set(storeKey, new MemoryRateLimitStore());
  }

  const activeStore = store ?? defaultStores.get(storeKey)!;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Not a route this limiter guards — pass through without spending budget.
    if (!shouldLimit(req)) {
      next();
      return;
    }

    const key = keyGenerator(req);
    const now = Date.now();
    const resultOrPromise = activeStore.increment(key, windowMs, now);

    const applyHeadersAndCheck = (record: RequestRecord) => {
      // Set headers
      const remaining = Math.max(0, maxRequests - record.count);
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString());

      if (record.count > maxRequests) {
        const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
        res.setHeader('Retry-After', retryAfter.toString());
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message,
            retryAfter
          }
        });
        return;
      }

      next();
    };

    if (resultOrPromise instanceof Promise) {
      resultOrPromise.then(applyHeadersAndCheck).catch(next);
    } else {
      applyHeadersAndCheck(resultOrPromise);
    }
  };
}


/**
 * Pre-configured limiters for different endpoints
 *
 * The `shouldLimit` predicates matter: these limiters are mounted on the
 * shared '/api/v1' prefix (so each router can keep its own absolute paths),
 * which means the middleware also sees /tags, /spaces, /graph, /items, etc.
 * Without the predicate a single dashboard page load burns the capture
 * budget and unrelated endpoints start returning 429.
 */

/** Matches a route path (ignoring query string) against exact prefixes. */
function isUnder(path: string, ...prefixes: string[]): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  return prefixes.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
}

export const captureLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 captures per minute
  message: 'Quá nhiều captures. Vui lòng thử lại sau 1 phút.',
  shouldLimit: (req) => isUnder(req.path, '/captures', '/api/v1/captures')
});

export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100, // 100 searches per minute
  message: 'Quá nhiều tìm kiếm. Vui lòng thử lại sau.',
  shouldLimit: (req) => isUnder(req.path, '/search', '/api/v1/search')
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 20, // 20 auth attempts per 15 minutes
  message: 'Quá nhiều lần thử xác thực. Vui lòng đợi 15 phút.'
});
