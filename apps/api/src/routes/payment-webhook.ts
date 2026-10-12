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
 *   6. Finds the matching `pending` order by `reference`. The
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
import { createSepayAdapter, SepayError } from '../payments/providers/sepay.js';
import { findOrderByReference, markOrderPaid, OrderError, rejectOrder } from '../payments/orders.js';

export interface WebhookRouterDeps {
  pool: Pool;
  bankAccount: string;
  webhookSecret: string;
  enabled: () => boolean;
}

interface EventRow {
  id: string;
}

export function createPaymentWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();
  const sepay = createSepayAdapter({
    secret: deps.webhookSecret,
    expectedAccount: deps.bankAccount
  });

  router.post('/webhooks/:provider', async (req: Request, res: Response) => {
    if (!deps.enabled()) {
      res.status(503).json({ error: { code: 'BILLING_DISABLED', message: 'Thanh toán chưa được bật' } });
      return;
    }
    if (req.params.provider !== 'sepay') {
      res.status(404).json({ error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider không được hỗ trợ' } });
      return;
    }
    if (!sepay.isConfigured()) {
      res.status(503).json({
        error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'SEPAY_WEBHOOK_SECRET / PAYMENT_BANK_ACCOUNT chưa cấu hình' }
      });
      return;
    }
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody
      ? (req as unknown as { rawBody: Buffer }).rawBody.toString('utf8')
      : JSON.stringify(req.body);
    const sig = req.header('x-sepay-signature');
    const sigValid = sepay.verifySignature(raw, sig);
    if (!sigValid) {
      // Record the rejected event for the admin to inspect.
      try {
        const txnId = (() => {
          try {
            const j = JSON.parse(raw);
            return String(j?.id ?? j?.referenceCode ?? 'unknown');
          } catch {
            return 'unknown';
          }
        })();
        await deps.pool.query(
          `INSERT INTO payment_events
             (provider, provider_txn_id, event_type, raw_payload, signature_valid, note)
           VALUES ('sepay', $1, 'unknown', $2::jsonb, FALSE, 'signature missing or invalid')
           ON CONFLICT (provider, provider_txn_id) DO NOTHING`,
          [txnId, raw]
        );
      } catch {/* ignore */}
      res.status(401).json({ error: { code: 'SIGNATURE_INVALID', message: 'Chữ ký webhook không hợp lệ' } });
      return;
    }

    let event;
    try {
      event = sepay.parse(raw);
      sepay.checkBeneficiary(event);
    } catch (e) {
      if (e instanceof SepayError) {
        res.status(e.status).json({ error: { code: e.code, message: e.message } });
        return;
      }
      throw e;
    }

    if (event.transferType !== 'in') {
      // Outbound transfers are not customer payments; acknowledge
      // 200 so the provider does not retry, but do nothing.
      res.status(200).json({ data: { ok: true, note: 'ignored outbound transfer' } });
      return;
    }
    // `event.reference` is guaranteed non-null because
    // `parse()` throws on a missing reference. Narrow the
    // type for the rest of the handler.
    const reference: string = event.reference;

    // Idempotent insert. The unique constraint on
    // (provider, provider_txn_id) makes a duplicate delivery
    // a no-op.
    let eventRow: EventRow;
    try {
      const inserted = await deps.pool.query<{ id: string }>(
        `INSERT INTO payment_events
           (provider, provider_txn_id, event_type, amount_vnd, reference,
            raw_payload, signature_valid, processed)
         VALUES ('sepay', $1, 'payment.in', $2, $3, $4::jsonb, TRUE, FALSE)
         ON CONFLICT (provider, provider_txn_id) DO UPDATE
           SET raw_payload = EXCLUDED.raw_payload
         RETURNING id::text`,
        [event.providerTxnId, event.amountVnd, event.reference, raw]
      );
      eventRow = { id: inserted.rows[0].id };
    } catch (e) {
      console.error('[webhook] insert payment_events failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi lưu sự kiện thanh toán' } });
      return;
    }

    // Locate the order by reference. If it does not exist,
    // the payment is for an order we never created (fraud or
    // operator typo). We mark the event as processed and
    // return 200 so the provider stops retrying; the admin
    // dashboard can show "unmatched".
    const order = await findOrderByReference(deps.pool, event.reference);
    if (!order) {
      await deps.pool.query(
        `UPDATE payment_events SET processed = TRUE, processed_at = NOW(),
            note = COALESCE(note, '') || ' unmatched reference'
          WHERE id = $1`,
        [eventRow.id]
      );
      res.status(200).json({ data: { ok: true, note: 'no matching order; recorded as unmatched' } });
      return;
    }

    try {
      const result = await markOrderPaid(deps.pool, {
        orderId: order.id,
        provider: 'sepay',
        providerTxnId: event.providerTxnId,
        amountVnd: event.amountVnd,
        reference: event.reference,
        bankAccount: event.bankAccount ?? undefined,
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
        await rejectOrder(deps.pool, order.id, `amount mismatch: ${event.amountVnd} != ${order.amountVnd}`);
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
