/**
 * Monitoring & Metrics
 *
 * Tracks request metrics, errors, and operation timing.
 */

interface MetricPoint {
  value: number;
  timestamp: number;
}

interface Counter {
  name: string;
  values: Map<string, number>;
}

interface Histogram {
  name: string;
  values: number[];
  max: number;
}

class Metrics {
  private counters: Map<string, Counter> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private requestTimings: Map<string, MetricPoint[]> = new Map();

  // Counter methods
  increment(name: string, labels: Record<string, string> = {}): void {
    const labelKey = this.labelKey(labels);
    let counter = this.counters.get(name);

    if (!counter) {
      counter = { name, values: new Map() };
      this.counters.set(name, counter);
    }

    const current = counter.values.get(labelKey) || 0;
    counter.values.set(labelKey, current + 1);
  }

  // Histogram methods
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const labelKey = this.labelKey(labels);
    const key = `${name}:${labelKey}`;
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = { name, values: [], max: 10000 };
      this.histograms.set(key, histogram);
    }

    histogram.values.push(value);
    if (histogram.values.length > histogram.max) {
      histogram.values.shift();
    }
  }

  // Request timing
  recordRequestTime(path: string, durationMs: number): void {
    let timings = this.requestTimings.get(path);
    if (!timings) {
      timings = [];
      this.requestTimings.set(path, timings);
    }

    timings.push({ value: durationMs, timestamp: Date.now() });

    // Keep only last 1000 timings per path
    if (timings.length > 1000) {
      timings.shift();
    }
  }

  // Get metrics
  getCounters(): Array<{ name: string; labels: string; value: number }> {
    const result: Array<{ name: string; labels: string; value: number }> = [];
    for (const counter of this.counters.values()) {
      for (const [label, value] of counter.values.entries()) {
        result.push({ name: counter.name, labels: label, value });
      }
    }
    return result;
  }

  getHistograms(): Array<{
    name: string;
    labels: string;
    count: number;
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  }> {
    const result: Array<{
      name: string;
      labels: string;
      count: number;
      p50: number;
      p95: number;
      p99: number;
      avg: number;
    }> = [];

    for (const [key, histogram] of this.histograms.entries()) {
      const [name, labels] = key.split(':');
      const sorted = [...histogram.values].sort((a, b) => a - b);
      const count = sorted.length;

      if (count === 0) continue;

      const p50 = sorted[Math.floor(count * 0.5)];
      const p95 = sorted[Math.floor(count * 0.95)];
      const p99 = sorted[Math.floor(count * 0.99)];
      const avg = sorted.reduce((s, v) => s + v, 0) / count;

      result.push({ name, labels, count, p50, p95, p99, avg });
    }

    return result;
  }

  getRequestTimings(path?: string): Array<{ path: string; p50: number; p95: number; count: number }> {
    const result: Array<{ path: string; p50: number; p95: number; count: number }> = [];

    const paths = path ? [path] : Array.from(this.requestTimings.keys());

    for (const p of paths) {
      const timings = this.requestTimings.get(p);
      if (!timings || timings.length === 0) continue;

      const values = timings.map(t => t.value).sort((a, b) => a - b);
      const count = values.length;
      const p50 = values[Math.floor(count * 0.5)];
      const p95 = values[Math.floor(count * 0.95)];

      result.push({ path: p, p50, p95, count });
    }

    return result;
  }

  private labelKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
  }
}

export const metrics = new Metrics();

/**
 * Express middleware for tracking request metrics
 */
export function metricsMiddleware() {
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      metrics.recordRequestTime(req.path, duration);

      metrics.increment('http_requests_total', {
        method: req.method,
        path: req.path,
        status: res.statusCode.toString()
      });

      if (res.statusCode >= 400) {
        metrics.increment('http_errors_total', {
          method: req.method,
          path: req.path,
          status: res.statusCode.toString()
        });
      }
    });

    next();
  };
}
