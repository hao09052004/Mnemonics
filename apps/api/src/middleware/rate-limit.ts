/**
 * Rate Limiting Middleware
 *
 * Simple in-memory rate limiter. For production, use Redis.
 */

import type { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
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
   *-through for routes outside its scope. Defaults to counting everything.
   */
  shouldLimit?: (req: Request) => boolean;
}

interface RequestRecord {
  count: number;
  resetAt: number;
}

const stores: Map<string, Map<string, RequestRecord>> = new Map();

/**
 * Create rate limiter middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.ip || 'unknown',
    message = 'Too many requests, please try again later.',
    shouldLimit = () => true
  } = config;

  const storeKey = `${windowMs}-${maxRequests}`;

  if (!stores.has(storeKey)) {
    stores.set(storeKey, new Map());
  }

  const store = stores.get(storeKey)!;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Not a route this limiter guards — pass through without spending budget.
    if (!shouldLimit(req)) {
      next();
      return;
    }

    const key = keyGenerator(req);
    const now = Date.now();

    // Cleanup expired entries periodically
    if (Math.random() < 0.01) {
      cleanupExpired(store, now);
    }

    let record = store.get(key);

    if (!record || record.resetAt < now) {
      record = {
        count: 1,
        resetAt: now + windowMs
      };
      store.set(key, record);
    } else {
      record.count++;
    }

    // Set headers
    const remaining = Math.max(0, maxRequests - record.count);
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString());

    if (record.count > maxRequests) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message,
          retryAfter: Math.ceil((record.resetAt - now) / 1000)
        }
      });
      return;
    }

    next();
  };
}

function cleanupExpired(store: Map<string, RequestRecord>, now: number): void {
  for (const [key, record] of store.entries()) {
    if (record.resetAt < now) {
      store.delete(key);
    }
  }
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
