/**
 * Billing router.
 *
 * Public pricing list, the caller's entitlement, and the
 * placeholder checkout / order routes. M3 wires the real
 * VietQR / SePay payment flow; this router only ships the
 * pricing list + the caller's current plan for the M2
 * pricing UI.
 */
import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { requireAuth, requirePermission, type AuthedRequest } from '../rbac.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEntitlement, listPlans } from '../entitlements.js';

export interface BillingRouterDeps {
  pool: Pool;
  supabase: SupabaseClient;
}

export function createBillingRouter(deps: BillingRouterDeps): Router {
  const router = Router();

  // GET /api/v1/billing/plans — public, no auth. The pricing
  // page is rendered for both signed-in and signed-out users.
  router.get('/plans', async (_req, res: Response) => {
    try {
      const plans = await listPlans(deps.pool);
      res.json({ data: { plans } });
    } catch (e) {
      console.error('[billing] listPlans failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải danh sách gói' } });
    }
  });

  // All routes below require a signed-in user.
  const auth = requireAuth({ pool: deps.pool, supabase: deps.supabase });

  // GET /api/v1/billing/me — the caller's current entitlement.
  router.get('/me', auth, async (req: AuthedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ' } });
      return;
    }
    try {
      const ent = await getEntitlement(deps.pool, req.userId);
      res.json({ data: { entitlement: ent } });
    } catch (e) {
      console.error('[billing] getEntitlement failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải thông tin gói' } });
    }
  });

  return router;
}
