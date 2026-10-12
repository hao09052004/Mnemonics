/**
 * Payment provider webhook.
 *
 * `POST /api/v1/billing/webhooks/:provider`
 *
 * The route is the public, signature-protected entry point
 * for payment providers. It:
 *
 *   1. Refuses to run when billing is disabled
 *      (BILLING_ENABLED !== 'true').
 *   2. Looks up the provider adapter. Unknown providers get 404.
 *   3. Verifies the signature. Invalid signatures are recorded
 *      in `payment_events` with `signature_valid = false` and
 *      the route returns 401 — the event is kept for audit.
 *   4. Parses the body. Malformed payloads return 400.
 *   5. Inserts a row into `payment_events` with the unique
 *      `(provider, provider_txn_id)` constraint. Duplicate
 *      deliveries hit the conflict and we return 200 (already
 *      processed) without re-applying.
 *   6. Finds the matching `pending` order by `orderCode`. The
 *      order must exist, be `pending`, and match the amount.
 *   7. Calls `markOrderPaid` which activates the subscription.
 *
 * Critical invariants:
 *   - No step trusts the inbound `status` field; the API
 *     re-derives the recipient, amount, and reference.
 *   - The webhook never trusts a flag like `paid = true` from
 *     the body. The only authoritative signal is a row in
 *     `payment_events` that passes the signature check.
 *   - No automatic renewal: the webhook activates one period.
 *     The user must pay again to extend.
 */
import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { type PayosAdapter, PayosError } from '../payments/providers/payos.js';
import {
  findOrderByOrderCode,
  markOrderPaid,
  OrderError,
  rejectOrder
} from '../payments/orders.js';

export interface WebhookRouterDeps {
  pool: Pool;
  payos: PayosAdapter;
  enabled: () => boolean;
}

interface EventRow {
  id: string;
}

export function createPaymentWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();

  router.post('/webhooks/:provider', async (req: Request, res: Response) => {
    if (!deps.enabled()) {
      res.status(503).json({ error: { code: 'BILLING_DISABLED', message: 'Thanh toán chưa được bật' } });
      return;
    }
    if (req.params.provider !== 'payos') {
      res.status(404).json({ error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider không được hỗ trợ' } });
      return;
    }
    if (!deps.payos.isConfigured()) {
      res.status(503).json({
        error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY chưa cấu hình' }
      });
      return;
    }
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody
      ? (req as unknown as { rawBody: Buffer }).rawBody.toString('utf8')
      : JSON.stringify(req.body);
    // PayOS sends the signature IN the body (`signature`
    // field) rather than as a header. The `verifyWebhook`
    // helper reads it from the body. We still accept an
    // optional `x-payos-signature` header for forward
    // compatibility.
    const headerSig = req.header('x-payos-signature') ?? req.header('x-signature');
    const sigValid = deps.payos.verifyWebhook(raw, headerSig);
    if (!sigValid) {
      // Record the rejected event for the admin to inspect.
      try {
        const txnId = (() => {
          try {
            const j = JSON.parse(raw);
            const orderCode = j?.data?.orderCode ?? j?.orderCode;
            return String(orderCode ?? 'unknown');
          } catch {
            return 'unknown';
          }
        })();
        await deps.pool.query(
          `INSERT INTO payment_events
             (provider, provider_txn_id, event_type, raw_payload, signature_valid, note)
           VALUES ('payos', $1, 'unknown', $2::jsonb, FALSE, 'signature missing or invalid')
           ON CONFLICT (provider, provider_txn_id) DO NOTHING`,
          [txnId, raw]
        );
      } catch {/* ignore */}
      res.status(401).json({ error: { code: 'SIGNATURE_INVALID', message: 'Chữ ký webhook không hợp lệ' } });
      return;
    }

    let event;
    try {
      event = deps.payos.parseWebhook(raw);
    } catch (e) {
      if (e instanceof PayosError) {
        res.status(e.status).json({ error: { code: e.code, message: e.message } });
        return;
      }
      throw e;
    }

    // PayOS uses `code: '00'` to signal success. Any other
    // value (`'01'`, `'02'`, …) is a non-payment event
    // (e.g. cancellation). Acknowledge 200 so PayOS does
    // not retry.
    if (event.code !== '00') {
      res.status(200).json({ data: { ok: true, note: `ignored non-success event (code=${event.code})` } });
      return;
    }

    // Idempotent insert. The unique constraint on
    // (provider, provider_txn_id) makes a duplicate delivery
    // a no-op. PayOS's transaction id is the integer
    // `orderCode`; we coerce it to a string for the column.
    const providerTxnId = String(event.orderCode);
    let eventRow: EventRow;
    try {
      const inserted = await deps.pool.query<{ id: string }>(
        `INSERT INTO payment_events
           (provider, provider_txn_id, event_type, amount_vnd, reference,
            raw_payload, signature_valid, processed)
         VALUES ('payos', $1, 'payment.in', $2, $3, $4::jsonb, TRUE, FALSE)
         ON CONFLICT (provider, provider_txn_id) DO UPDATE
           SET raw_payload = EXCLUDED.raw_payload
         RETURNING id::text`,
        [providerTxnId, event.amount, event.reference, raw]
      );
      eventRow = { id: inserted.rows[0].id };
    } catch (e) {
      console.error('[webhook] insert payment_events failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi lưu sự kiện thanh toán' } });
      return;
    }

    // Locate the order by PayOS `orderCode`. If it does not
    // exist, the payment is for an order we never created
    // (fraud or operator typo). Mark the event as processed
    // and return 200 so PayOS stops retrying; the admin
    // dashboard can show "unmatched".
    const order = await findOrderByOrderCode(deps.pool, event.orderCode);
    if (!order) {
      await deps.pool.query(
        `UPDATE payment_events SET processed = TRUE, processed_at = NOW(),
            note = COALESCE(note, '') || ' unmatched orderCode'
          WHERE id = $1`,
        [eventRow.id]
      );
      res.status(200).json({ data: { ok: true, note: 'no matching order; recorded as unmatched' } });
      return;
    }

    try {
      const result = await markOrderPaid(deps.pool, {
        orderId: order.id,
        provider: 'payos',
        providerTxnId,
        amountVnd: event.amount,
        reference: event.reference,
        bankAccount: event.counterAccountNumber ?? undefined,
        paidAt: event.paidAt
      });
      await deps.pool.query(
        `UPDATE payment_events
           SET order_id = $2, processed = TRUE, processed_at = NOW()
         WHERE id = $1`,
        [eventRow.id, order.id]
      );
      res.status(200).json({
        data: {
          ok: true,
          orderId: order.id,
          activated: result.activated,
          idempotent: !result.activated
        }
      });
    } catch (e) {
      if (e instanceof OrderError && e.code === 'AMOUNT_MISMATCH') {
        // The order exists but the amount does not match.
        // Mark both the event and the order as rejected; the
        // admin can reconcile manually.
        await rejectOrder(deps.pool, order.id, `amount mismatch: ${event.amount} != ${order.amountVnd}`);
        await deps.pool.query(
          `UPDATE payment_events SET processed = TRUE, processed_at = NOW(),
              note = 'amount mismatch'
            WHERE id = $1`,
          [eventRow.id]
        );
        res.status(422).json({ error: { code: 'AMOUNT_MISMATCH', message: e.message } });
        return;
      }
      console.error('[webhook] markOrderPaid failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi kích hoạt gói' } });
    }
  });

  return router;
}
