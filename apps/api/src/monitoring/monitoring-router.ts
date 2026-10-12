/**
 * Monitoring Routes
 *
 * Exposes metrics and health information.
 *
 * - `/health` is **public** (load balancers, k8s probes).
 * - `/metrics` and `/stats` are gated by the `admin.system.read`
 *   permission. They expose counter and timing information that
 *   is useful for operators but not for the public.
 *
 * The router reads the permission set from `request.userPermissions`
 * (populated by `requireAuth` in the production mount). When the
 * router is mounted in isolation (unit tests, dev tools) the
 * middleware that injects this field may be missing — in that case
 * the gate refuses with 403 so we never accidentally expose
 * operational counters in a context that did not opt in.
 */

import express, { type Application, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { metrics } from './metrics.js';

export interface MonitoringDeps {
  pool: Pool;
}

function requireSystemRead() {
  return (request: Request, response: Response, next: (err?: unknown) => void) => {
    const perms = (request as Request & { userPermissions?: ReadonlySet<string> | null })
      .userPermissions;
    if (!perms || !perms.has('admin.system.read')) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Yêu cầu quyền admin.system.read', requestId: request.id }
      });
      return;
    }
    next();
  };
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
  router.get('/metrics', requireSystemRead(), (_req: unknown, res: Response) => {
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
  router.get('/stats', requireSystemRead(), (_req: unknown, res: Response) => {
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
