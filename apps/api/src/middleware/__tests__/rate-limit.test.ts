/**
 * Rate Limiter Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { rateLimit, captureLimiter, searchLimiter } from '../rate-limit.js';

describe('rateLimit', () => {
  it('should allow requests under the limit', () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 3 });
    const req = { ip: '127.0.0.1' } as any;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    limiter(req, res, next);
    limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('should block requests over the limit', () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 2 });
    const req = { ip: '127.0.0.1' } as any;
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    } as any;
    const next = vi.fn();

    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next); // This should be blocked

    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('should use different keys for different IPs', () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    const req1 = { ip: '1.1.1.1' } as any;
    const req2 = { ip: '2.2.2.2' } as any;
    const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    limiter(req1, res, next);
    limiter(req2, res, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  describe('shouldLimit scoping (regression 2026-10-04)', () => {
    const makeRes = () =>
      ({
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }) as any;

    it('does not spend budget on routes the limiter does not guard', () => {
      const limiter = rateLimit({
        windowMs: 60_000,
        maxRequests: 1,
        shouldLimit: (req) => req.path === '/captures'
      });
      const res = makeRes();
      const next = vi.fn();
      // The limiter store is module-level and keyed by windowMs-maxRequests,
      // so use an IP no other test in this file has touched.
      const req = { ip: '10.10.10.10' } as any;

      // A non-capture route must be a pass-through: no headers, no counting.
      limiter({ ...req, path: '/spaces' }, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      // The guarded route still gets its full budget.
      limiter({ ...req, path: '/captures' }, res, next);
      expect(next).toHaveBeenCalledTimes(2);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('captureLimiter only counts capture routes, so /tags is never throttled by it', () => {
      const res = makeRes();
      const next = vi.fn();

      // Well past the 30/min capture budget, but none of these are captures.
      for (let i = 0; i < 40; i += 1) {
        captureLimiter({ ip: '9.9.9.9', path: '/api/v1/tags' } as any, res, next);
        captureLimiter({ ip: '9.9.9.9', path: '/api/v1/spaces' } as any, res, next);
      }
      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(80);
    });

    it('captureLimiter still throttles actual captures past the limit', () => {
      const res = makeRes();
      const next = vi.fn();

      for (let i = 0; i < 31; i += 1) {
        captureLimiter({ ip: '8.8.8.8', path: '/api/v1/captures' } as any, res, next);
      }
      expect(res.status).toHaveBeenCalledWith(429);
      expect(next).toHaveBeenCalledTimes(30);
    });

    it('searchLimiter counts search routes but not other API routes', () => {
      const res = makeRes();
      const next = vi.fn();

      for (let i = 0; i < 40; i += 1) {
        searchLimiter({ ip: '7.7.7.7', path: '/api/v1/items' } as any, res, next);
      }
      expect(res.status).not.toHaveBeenCalled();

      for (let i = 0; i < 101; i += 1) {
        searchLimiter({ ip: '6.6.6.6', path: '/api/v1/search' } as any, res, next);
      }
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('ignores the query string and trailing slashes when matching', () => {
      const limiter = rateLimit({
        windowMs: 60_000,
        maxRequests: 1,
        shouldLimit: (req) => req.path.split('?')[0] === '/captures'
      });
      const res = makeRes();
      const next = vi.fn();

      limiter({ ip: '5.5.5.5', path: '/captures/image' } as any, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
