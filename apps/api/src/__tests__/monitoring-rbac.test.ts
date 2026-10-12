/**
 * Monitoring router RBAC tests.
 *
 * Verifies that `/metrics` and `/stats` refuse to serve a
 * caller that does not have the `admin.system.read`
 * permission, even when the router is mounted in isolation
 * (the production mount also applies the permission
 * middleware at server.ts level — this is defence in depth).
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createMonitoringRouter } from '../monitoring/monitoring-router.js';

function mockPool() {
  return {
    query: vi.fn(async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }))
  } as unknown as Pool;
}

function buildApp(perms: ReadonlySet<string> | null) {
  const app = express();
  const router = createMonitoringRouter({ pool: mockPool() });
  // Inject a fake auth context like `requireAuth` would.
  app.use((req, _res, next) => {
    (req as any).userPermissions = perms;
    next();
  });
  app.use(router);
  return app;
}

describe('monitoring router permission gate', () => {
  it('GET /health is public', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });

  it('GET /metrics refuses an unauthenticated caller with 403', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /stats refuses a user with the wrong permission set', async () => {
    const app = buildApp(new Set(['admin.analytics.read']));
    const res = await request(app).get('/stats');
    expect(res.status).toBe(403);
  });

  it('GET /metrics allows a caller with admin.system.read', async () => {
    const app = buildApp(new Set(['admin.system.read']));
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uptime_seconds');
    expect(res.body).toHaveProperty('counters');
  });

  it('GET /stats allows a caller with admin.system.read', async () => {
    const app = buildApp(new Set(['admin.system.read']));
    const res = await request(app).get('/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_requests');
    expect(res.body).toHaveProperty('total_errors');
  });
});
