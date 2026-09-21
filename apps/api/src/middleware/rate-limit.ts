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
    message = 'Too many requests, please try again later.'
  } = config;

  const storeKey = `${windowMs}-${maxRequests}`;

  if (!stores.has(storeKey)) {
    stores.set(storeKey, new Map());
  }

  const store = stores.get(storeKey)!;

  return (req: Request, res: Response, next: NextFunction): void => {
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
 */
export const captureLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 captures per minute
  message: 'Quá nhiều captures. Vui lòng thử lại sau 1 phút.'
});

export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100, // 100 searches per minute
  message: 'Quá nhiều tìm kiếm. Vui lòng thử lại sau.'
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 20, // 20 auth attempts per 15 minutes
  message: 'Quá nhiều lần thử xác thực. Vui lòng đợi 15 phút.'
});
