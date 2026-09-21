/**
 * Rate Limiter Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { rateLimit } from '../rate-limit.js';

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
});
