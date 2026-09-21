/**
 * Monitoring Routes
 *
 * Exposes metrics and health information.
 */

import express, { type Application, type Response } from 'express';
import type { Pool } from 'pg';
import { metrics } from './metrics.js';

export interface MonitoringDeps {
  pool: Pool;
}

export function createMonitoringRouter(deps: MonitoringDeps): Application {
  const { pool } = deps;
  const router = express.Router() as Application;

  // Health check
  router.get('/health', async (_req: unknown, res: Response) => {
    const checks: Record<string, string> = {};

    // Check database
    try {
      await pool.query('SELECT 1');
      checks.database = 'ok';
    } catch (error) {
      checks.database = 'error';
    }

    const isHealthy = Object.values(checks).every(c => c === 'ok');

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks
    });
  });

  // Metrics endpoint
  router.get('/metrics', (_req: unknown, res: Response) => {
    const counters = metrics.getCounters();
    const histograms = metrics.getHistograms();
    const timings = metrics.getRequestTimings();

    res.json({
      counters,
      histograms,
      request_timings: timings,
      uptime_seconds: Math.floor(process.uptime()),
      memory_usage_mb: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)
    });
  });

  // Stats endpoint (simpler view)
  router.get('/stats', (_req: unknown, res: Response) => {
    const counters = metrics.getCounters();
    const totalRequests = counters
      .filter(c => c.name === 'http_requests_total')
      .reduce((sum, c) => sum + c.value, 0);

    const totalErrors = counters
      .filter(c => c.name === 'http_errors_total')
      .reduce((sum, c) => sum + c.value, 0);

    res.json({
      total_requests: totalRequests,
      total_errors: totalErrors,
      error_rate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      uptime_seconds: Math.floor(process.uptime())
    });
  });

  return router;
}
