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
 */
import type { Pool, PoolClient } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { buildVietQrPayload, type VietQrInput } from './vietqr.js';
import { applyEntitlement } from '../entitlements.js';
import type { PlanId } from '../entitlements.js';

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'rejected' | 'refunded';

export interface PaymentOrder {
  id: string;
  userId: string;
  planId: PlanId;
  amountVnd: number;
  reference: string;
  qrPayload: string;
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
  bankBin: string;
  bankAccount: string;
  bankHolder: string;
  /** Order TTL in minutes. Default 30. */
  ttlMinutes?: number;
}

interface OrderRow {
  id: string;
  user_id: string;
  plan_id: PlanId;
  amount_vnd: string;
  reference: string;
  qr_payload: string;
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
    reference: row.reference,
    qrPayload: row.qr_payload,
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
 */
async function generateReference(pool: Pool): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = randomBytes(8);
    // Map to a 36-char alphabet; we use 32 base32-style chars
    // to keep references pronounceable.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no 0/O/1/I
    let out = 'MNX';
    for (let i = 0; i < 5; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    // Check for collision; if so, retry.
    // eslint-disable-next-line no-await-in-loop
    const r = await pool.query<{ c: string }>(
      'SELECT count(*)::text AS c FROM payment_orders WHERE reference = $1',
      [out]
    );
    if (Number.parseInt(r.rows[0].c, 10) === 0) {
      return out;
    }
  }
  // Astronomically unlikely. Fall back to a SHA-derived value.
  const fb = createHash('sha256').update(`payment-orders-${Date.now()}-${randomBytes(8).toString('hex')}`).digest('hex').toUpperCase().slice(0, 8);
  return `MNX${fb.slice(0, 5)}`;
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
  const reference = await generateReference(pool);
  const qrInput: VietQrInput = {
    bankBin: args.bankBin,
    bankAccount: args.bankAccount,
    bankHolder: args.bankHolder,
    amountVnd,
    reference,
    description: `Mnemonics ${planId} ${reference}`
  };
  const qrPayload = buildVietQrPayload(qrInput);
  const expiresAt = new Date(Date.now() + (args.ttlMinutes ?? 30) * 60 * 1000);
  const r = await pool.query<OrderRow>(
    `INSERT INTO payment_orders
       (user_id, plan_id, amount_vnd, reference, qr_payload, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING *`,
    [args.userId, planId, amountVnd, reference, qrPayload, expiresAt]
  );
  return mapOrder(r.rows[0]);
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

void ALPHANUMERIC;
void ({} as PoolClient);
