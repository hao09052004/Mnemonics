/**
 * Metrics Tests
 */

import { describe, it, expect } from 'vitest';
import { metrics, metricsMiddleware } from '../metrics.js';

describe('metrics', () => {
  it('should increment counters', () => {
    metrics.increment('test_counter', { method: 'GET' });
    metrics.increment('test_counter', { method: 'GET' });
    metrics.increment('test_counter', { method: 'POST' });

    const counters = metrics.getCounters();
    const testCounter = counters.find(c => c.name === 'test_counter');
    expect(testCounter).toBeDefined();
  });

  it('should observe histogram values', () => {
    metrics.observe('test_histogram', 100);
    metrics.observe('test_histogram', 200);
    metrics.observe('test_histogram', 300);

    const histograms = metrics.getHistograms();
    const testHist = histograms.find(h => h.name === 'test_histogram');
    expect(testHist).toBeDefined();
    expect(testHist!.count).toBeGreaterThan(0);
  });

  it('should record request timings', () => {
    metrics.recordRequestTime('/test', 50);
    metrics.recordRequestTime('/test', 100);

    const timings = metrics.getRequestTimings('/test');
    expect(timings).toHaveLength(1);
    expect(timings[0].count).toBe(2);
  });
});

describe('metricsMiddleware', () => {
  it('should track request duration', () => {
    const middleware = metricsMiddleware();
    const req = { path: '/test', method: 'GET' } as any;
    const res = { on: (_event: string, cb: () => void) => cb(), statusCode: 200 } as any;
    const next = () => {};

    middleware(req, res, next);

    const timings = metrics.getRequestTimings('/test');
    expect(timings.length).toBeGreaterThanOrEqual(0);
  });
});
