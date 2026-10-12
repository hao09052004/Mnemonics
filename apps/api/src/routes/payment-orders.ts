/**
 * Payment order routes (user-facing).
 *
 * `POST /api/v1/billing/orders` — create a pending order and
 *   return a PayOS-hosted checkout URL the frontend redirects
 *   the user to.
 * `GET  /api/v1/billing/orders/:id` — read the current state.
 * `GET  /api/v1/billing/orders` — list the caller's history.
 * `POST /api/v1/billing/orders/:id/cancel` — cancel a pending order.
 *
 * PayOS renders its own QR / hosted page; we no longer ship
 * a raw EMV NAPAS-247 string from the backend.
 */
import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../rbac.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PayosAdapter } from '../payments/providers/payos.js';
import {
  createOrder,
  getOrder,
  listOrders,
  cancelOrder,
  OrderError
} from '../payments/orders.js';
import { MASTERY_MONTHLY_PLAN_ID, MASTERY_YEARLY_PLAN_ID, type PlanId } from '../entitlements.js';

const createOrderSchema = z
  .object({
    planId: z.enum([MASTERY_MONTHLY_PLAN_ID, MASTERY_YEARLY_PLAN_ID])
  })
  .strict();

export interface PaymentOrdersRouterDeps {
  pool: Pool;
  supabase: SupabaseClient;
  payos: PayosAdapter;
  /** When false, all order endpoints return 503. */
  enabled: () => boolean;
}

function orderErrorResponse(e: unknown, defaultCode: string, res: Response): { status: number; body: object } {
  if (e instanceof OrderError) {
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message } }
    };
  }
  if (e instanceof Error && /payos/i.test(e.message)) {
    return {
      status: 502,
      body: { error: { code: 'PAYOS_PROVIDER_ERROR', message: e.message } }
    };
  }
  console.error('[payment-orders]', defaultCode, e);
  return {
    status: 500,
    body: { error: { code: defaultCode, message: 'Đã xảy ra lỗi máy chủ' } }
  };
}

export function createPaymentOrdersRouter(deps: PaymentOrdersRouterDeps): Router {
  const router = Router();
  const auth = requireAuth({ pool: deps.pool, supabase: deps.supabase });

  router.post('/orders', auth, async (req: AuthedRequest, res: Response) => {
    if (!deps.enabled()) {
      res.status(503).json({ error: { code: 'BILLING_DISABLED', message: 'Thanh toán chưa được bật' } });
      return;
    }
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_ORDER_PAYLOAD', message: 'Gói không hợp lệ' } });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ' } });
      return;
    }
    try {
      const order = await createOrder(deps.pool, {
        userId: req.userId,
        planId: parsed.data.planId as PlanId,
        payos: deps.payos
      });
      res.status(201).json({
        data: {
          order: {
            ...order,
            // The bigint `id` is serialized as a string for
            // JSON safety; downstream code can parse it.
            checkoutUrl: order.checkoutUrl
          },
          checkout: {
            url: order.checkoutUrl,
            orderCode: order.orderCode,
            amount: order.amountVnd
          }
        }
      });
      // Funnel: checkout started. We do NOT store the amount in
      // the metadata (the order_id is enough to link back).
      try {
        const { emitAnalyticsEvent } = await import('../analytics.js');
        emitAnalyticsEvent(deps.pool, {
          userId: req.userId,
          eventName: 'checkout_started',
          entityType: order.planId,
          metadata: { orderId: String(order.id), orderCode: order.orderCode }
        });
      } catch {/* swallow */}
    } catch (e) {
      const r = orderErrorResponse(e, 'ORDER_CREATE_FAILED', res);
      res.status(r.status).json(r.body);
    }
  });

  router.get('/orders', auth, async (req: AuthedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ' } });
      return;
    }
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
    try {
      const items = await listOrders(deps.pool, req.userId, limit, offset);
      res.json({ data: { items, limit, offset } });
    } catch (e) {
      console.error('[payment-orders] list failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải danh sách đơn hàng' } });
    }
  });

  router.get('/orders/:id', auth, async (req: AuthedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ' } });
      return;
    }
    try {
      const order = await getOrder(deps.pool, String(req.params.id), req.userId);
      if (!order) {
        res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng' } });
        return;
      }
      res.json({ data: { order } });
    } catch (e) {
      console.error('[payment-orders] get failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải đơn hàng' } });
    }
  });

  router.post('/orders/:id/cancel', auth, async (req: AuthedRequest, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ' } });
      return;
    }
    try {
      const order = await cancelOrder(deps.pool, String(req.params.id), req.userId);
      res.json({ data: { order } });
    } catch (e) {
      const r = orderErrorResponse(e, 'ORDER_CANCEL_FAILED', res);
      res.status(r.status).json(r.body);
    }
  });

  return router;
}
