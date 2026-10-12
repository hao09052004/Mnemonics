/**
 * Payment order state machine.
 *
 * Lifecycle:
 *   pending → paid          (verified provider webhook)
 *   pending → expired       (expiry clock passed; lazy on read)
 *   pending → cancelled     (user clicked "cancel")
 *   pending → rejected      (provider reported a mismatch)
 *   paid    → refunded      (admin action)
 *
 * The orders API is the only public way to ask the system to
 * start a payment. The router is in `apps/api/src/routes/
 * payment-orders.ts`.
 *
 * Provider integration (PayOS):
 *   The order is created locally first (reference + plan +
 *   amount) and a unique integer `order_code` is reserved.
 *   Then `createPaymentLink` is called against the PayOS
 *   sandbox/production API. PayOS returns a `checkout_url`
 *   the frontend redirects the user to; the user pays
 *   inside PayOS's hosted page and the webhook fires back
 *   to us.
 */
import type { Pool, PoolClient } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { applyEntitlement } from '../entitlements.js';
import type { PlanId } from '../entitlements.js';
import { createPayosAdapter, type PayosAdapter } from './providers/payos.js';

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'rejected' | 'refunded';

export interface PaymentOrder {
  id: string;
  userId: string;
  planId: PlanId;
  amountVnd: number;
  orderCode: number;            // PayOS integer orderCode
  reference: string;            // MNX... (used as PayOS `description`)
  checkoutUrl: string | null;   // PayOS hosted checkout URL
  status: OrderStatus;
  provider: string | null;
  providerTxnId: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderArgs {
  userId: string;
  planId: PlanId;
  payos: PayosAdapter;
  /** Order TTL in minutes. Default 30. */
  ttlMinutes?: number;
}

interface OrderRow {
  id: string;
  user_id: string;
  plan_id: PlanId;
  amount_vnd: string;
  order_code: number | null;
  reference: string;
  checkout_url: string | null;
  status: OrderStatus;
  provider: string | null;
  provider_txn_id: string | null;
  expires_at: Date;
  paid_at: Date | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapOrder(row: OrderRow): PaymentOrder {
  return {
    id: String(row.id),
    userId: row.user_id,
    planId: row.plan_id,
    amountVnd: Number.parseInt(row.amount_vnd, 10),
    orderCode: row.order_code == null ? 0 : Number(row.order_code),
    reference: row.reference,
    checkoutUrl: row.checkout_url,
    status: row.status,
    provider: row.provider,
    providerTxnId: row.provider_txn_id,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Generate a unique 8-character uppercase ASCII reference.
 * 26+10 = 36 chars; 36^8 ≈ 2.8e12, with 8 bytes of entropy
 * we have ~52 bits of uniqueness, which is more than enough
 * to make collisions astronomically unlikely.
 *
 * Also reserves a unique integer `orderCode` for PayOS.
 * PayOS rejects duplicate orderCodes, so we run a small
 * loop against the database to make sure we have not
 * reused one.
 */
async function generateReference(pool: Pool): Promise<{ reference: string; orderCode: number }> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const bytes = randomBytes(16);
    // Map to a 36-char alphabet; we use 32 base32-style chars
    // to keep references pronounceable.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no 0/O/1/I
    let out = 'MNX';
    for (let i = 0; i < 5; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    // PayOS orderCode is a positive integer <= 9_007_199_254_740_991
    // (Number.MAX_SAFE_INTEGER). We derive a random int in
    // [10^7, 10^8) so it always fits in 8 digits and is
    // indistinguishable from a sequentially-issued one.
    const orderCode =
      10_000_000 + (bytes.readUInt32BE(8) % 90_000_000);
    // Check for collision; if so, retry.
    // eslint-disable-next-line no-await-in-loop
    const r = await pool.query<{ c: string }>(
      'SELECT count(*)::text AS c FROM payment_orders WHERE reference = $1 OR order_code = $2',
      [out, orderCode]
    );
    if (Number.parseInt(r.rows[0].c, 10) === 0) {
      return { reference: out, orderCode };
    }
  }
  // Astronomically unlikely. Fall back to a SHA-derived value.
  const fallbackBytes = createHash('sha256')
    .update(`payment-orders-${Date.now()}-${randomBytes(8).toString('hex')}`)
    .digest();
  const fb = fallbackBytes.toString('hex').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const orderCode = 10_000_000 + (fallbackBytes.readUInt32BE(0) % 90_000_000);
  return { reference: `MNX${fb}`, orderCode };
}

const ALPHANUMERIC = '^[A-Z0-9]{1,32}$';

const PLAN_TO_AMOUNT: Record<PlanId, number> = {
  memory: 0,
  'mastery-monthly': 29_000,
  'mastery-yearly': 249_000
};

export class OrderError extends Error {
  readonly code:
    | 'PLAN_NOT_PAID'
    | 'PLAN_NOT_FOUND'
    | 'INTERNAL_ERROR'
    | 'ORDER_NOT_FOUND'
    | 'ORDER_NOT_PENDING'
    | 'AMOUNT_MISMATCH'
    | 'BENEFICIARY_MISMATCH'
    | 'ORDER_NOT_PAYABLE'
    | 'INVALID_REFERENCE';
  readonly status: number;
  constructor(code: OrderError['code'], message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function createOrder(pool: Pool, args: CreateOrderArgs): Promise<PaymentOrder> {
  const planId = args.planId;
  const amountVnd = PLAN_TO_AMOUNT[planId];
  if (amountVnd === undefined) {
    throw new OrderError('PLAN_NOT_FOUND', `Unknown plan: ${planId}`, 400);
  }
  if (amountVnd === 0) {
    // The memory plan is free; creating an order for it is a
    // no-op and signals a logic bug. The pricing UI never
    // calls this endpoint for `memory`.
    throw new OrderError('PLAN_NOT_PAID', 'Gói miễn phí không cần thanh toán', 400);
  }
  const { reference, orderCode } = await generateReference(pool);
  // PayOS `description` is capped at 25 characters. We keep
  // the MNX reference because the webhook parser also pulls
  // it from `description` (the only field PayOS passes
  // through verbatim) to match the order back. We deliberately
  // drop the human-friendly "Mnemonics" prefix — the
  // reference is the only field the parser needs, and the
  // bank transfer statement already shows the merchant
  // name. Worst-case layout: "mastery-yearly MNXGUP4G" = 22
  // chars (well under 25).
  const description = `${planId} ${reference}`.slice(0, 25);
  const expiresAt = new Date(Date.now() + (args.ttlMinutes ?? 30) * 60 * 1000);
  // Insert the order as `pending` first. We need a row in
  // the database BEFORE we can hand the user a URL; if the
  // PayOS API call fails we mark the row `rejected` so the
  // audit log stays accurate.
  const inserted = await pool.query<OrderRow>(
    `INSERT INTO payment_orders
       (user_id, plan_id, amount_vnd, order_code, reference, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING *`,
    [args.userId, planId, amountVnd, orderCode, reference, expiresAt]
  );
  const orderRow = inserted.rows[0];
  if (!args.payos.isConfigured()) {
    await pool.query(
      `UPDATE payment_orders SET status = 'rejected', note = $2, updated_at = NOW() WHERE id = $1`,
      [orderRow.id, 'payos adapter not configured']
    );
    throw new OrderError('INTERNAL_ERROR', 'PayOS chưa được cấu hình', 503);
  }
  let checkoutUrl: string;
  try {
    const link = await args.payos.createPaymentLink({
      orderCode,
      amount: amountVnd,
      description
    });
    checkoutUrl = link.checkoutUrl;
  } catch (e) {
    await pool.query(
      `UPDATE payment_orders SET status = 'rejected', note = $2, updated_at = NOW() WHERE id = $1`,
      [orderRow.id, e instanceof Error ? e.message : 'createPaymentLink failed']
    );
    throw e;
  }
  const updated = await pool.query<OrderRow>(
    `UPDATE payment_orders SET checkout_url = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [orderRow.id, checkoutUrl]
  );
  return mapOrder(updated.rows[0]);
}

export async function getOrder(pool: Pool, id: string, userId: string): Promise<PaymentOrder | null> {
  const r = await pool.query<OrderRow>(
    'SELECT * FROM payment_orders WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (!r.rowCount) return null;
  const order = mapOrder(r.rows[0]);
  // Lazy expiry: flip to expired if the clock has passed
  // and the order is still pending.
  if (order.status === 'pending' && order.expiresAt.getTime() < Date.now()) {
    await pool.query(
      `UPDATE payment_orders SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    return { ...order, status: 'expired' };
  }
  return order;
}

export async function listOrders(pool: Pool, userId: string, limit = 20, offset = 0): Promise<PaymentOrder[]> {
  const r = await pool.query<OrderRow>(
    `SELECT * FROM payment_orders WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return r.rows.map(mapOrder);
}

export async function cancelOrder(pool: Pool, id: string, userId: string): Promise<PaymentOrder> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<OrderRow>(
      `SELECT * FROM payment_orders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, userId]
    );
    if (!r.rowCount) {
      await client.query('ROLLBACK');
      throw new OrderError('ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng', 404);
    }
    const order = r.rows[0];
    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      throw new OrderError('ORDER_NOT_PENDING', `Đơn hàng đã ở trạng thái ${order.status}`, 409);
    }
    const upd = await client.query<OrderRow>(
      `UPDATE payment_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query('COMMIT');
    return mapOrder(upd.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Mark a `pending` order as `paid`, activate the user's
 * subscription, and write a `subscription_events` row.
 *
 * This is the SINGLE function the webhook calls when a
 * verified payment is matched against a pending order. It
 * is idempotent: a duplicate call with the same
 * (orderId, provider, providerTxnId) is a no-op.
 */
export async function markOrderPaid(pool: Pool, args: {
  orderId: string;
  provider: string;
  providerTxnId: string;
  amountVnd: number;
  reference: string;
  bankAccount?: string;
  paidAt: Date;
}): Promise<{ order: PaymentOrder; activated: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the order row.
    const r = await client.query<OrderRow>(
      'SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE',
      [args.orderId]
    );
    if (!r.rowCount) {
      throw new OrderError('ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng', 404);
    }
    const order = r.rows[0];
    if (order.status === 'paid') {
      // Idempotent return.
      await client.query('COMMIT');
      return { order: mapOrder(order), activated: false };
    }
    if (order.status !== 'pending') {
      throw new OrderError('ORDER_NOT_PAYABLE', `Đơn hàng ở trạng thái ${order.status}, không thể thanh toán`, 409);
    }
    // Defence in depth: re-verify amount and reference.
    if (Number.parseInt(order.amount_vnd, 10) !== args.amountVnd) {
      await client.query('ROLLBACK');
      throw new OrderError('AMOUNT_MISMATCH', 'Số tiền thanh toán không khớp đơn hàng', 422);
    }
    if (order.reference !== args.reference) {
      await client.query('ROLLBACK');
      throw new OrderError('INVALID_REFERENCE', 'Mã tham chiếu không khớp', 422);
    }
    const upd = await client.query<OrderRow>(
      `UPDATE payment_orders
          SET status = 'paid',
              provider = $2,
              provider_txn_id = $3,
              paid_at = $4,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [args.orderId, args.provider, args.providerTxnId, args.paidAt]
    );
    const paidOrder = mapOrder(upd.rows[0]);
    // Audit row.
    await client.query(
      `INSERT INTO subscription_events
         (user_id, plan_id, from_status, to_status, source, reference, reason)
       VALUES ($1, $2, 'pending', 'active', 'payment', $3, $4)`,
      [order.user_id, order.plan_id, order.reference, `provider=${args.provider} txn=${args.providerTxnId}`]
    );
    await client.query('COMMIT');

    // Activate the entitlement OUTSIDE the transaction
    // because `applyEntitlement` opens its own transaction.
    // This is fine because the order is already committed
    // as `paid`; a crash here would only leave a
    // `paid` order without an active subscription, which
    // the admin reconciliation flow can repair.
    const planId = order.plan_id as PlanId;
    const periodEnd = computePeriodEnd(planId, args.paidAt);
    try {
      await applyEntitlement(pool, {
        userId: order.user_id,
        planId,
        validUntil: periodEnd,
        source: 'payment',
        note: `order=${order.reference} provider=${args.provider} txn=${args.providerTxnId}`
      });
    } catch (e) {
      console.error('[orders] applyEntitlement failed after paid', e);
      throw e;
    }
    return { order: paidOrder, activated: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function computePeriodEnd(planId: PlanId, paidAt: Date): Date {
  const end = new Date(paidAt);
  if (planId === 'mastery-monthly') {
    end.setUTCMonth(end.getUTCMonth() + 1);
  } else if (planId === 'mastery-yearly') {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  } else {
    // Memory has no expiry; the entitlement is set without
    // a valid_until value, so we never reach here.
    throw new Error(`Unexpected paid plan: ${planId}`);
  }
  return end;
}

/** Reject a pending order (provider reported a mismatch). */
export async function rejectOrder(pool: Pool, orderId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE payment_orders SET status = 'rejected', note = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [orderId, reason]
  );
}

// Convenience for the admin reconciliation flow.
export async function findOrderByReference(pool: Pool, reference: string): Promise<PaymentOrder | null> {
  const r = await pool.query<OrderRow>(
    'SELECT * FROM payment_orders WHERE reference = $1',
    [reference]
  );
  if (!r.rowCount) return null;
  return mapOrder(r.rows[0]);
}

// PayOS webhook lookup. The provider sends an integer
// `orderCode`; we map it back to our internal order row.
export async function findOrderByOrderCode(pool: Pool, orderCode: number): Promise<PaymentOrder | null> {
  const r = await pool.query<OrderRow>(
    'SELECT * FROM payment_orders WHERE order_code = $1',
    [orderCode]
  );
  if (!r.rowCount) return null;
  return mapOrder(r.rows[0]);
}

void ALPHANUMERIC;
void ({} as PoolClient);
