/**
 * M3 — VietQR + SePay webhook integration test.
 *
 * Requires a real Postgres. Skipped when DATABASE_URL is missing.
 *
 * Coverage:
 *   - Creating a `mastery-monthly` order yields the documented
 *     29,000 VND amount, a unique MNX-style reference, and a
 *     non-empty QR payload.
 *   - Creating a `mastery-yearly` order yields 249,000 VND.
 *   - The webhook rejects unsigned deliveries.
 *   - The webhook accepts a correctly-signed delivery,
 *     marks the order as paid, and upgrades the user to
 *     Mastery (with the documented 30-day period).
 *   - A second delivery with the same provider txn id is
 *     idempotent — it does not re-apply the entitlement.
 *   - A wrong amount is rejected and the order is not paid.
 *   - A webhook for an unknown reference is recorded as
 *     `unmatched` and returns 200.
 *   - Cancelling a pending order flips it to `cancelled`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createPool } from '@mnemonics/database';
import { createPaymentOrdersRouter } from '../../routes/payment-orders.js';
import { createPaymentWebhookRouter } from '../../routes/payment-webhook.js';
import { getEntitlement } from '../../entitlements.js';
import type { SupabaseClient } from '@supabase/supabase-js';

function loadDotEnv(): void {
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {/* ignore */}
}
loadDotEnv();

const DB_URL = process.env.DATABASE_URL ?? '';
const skipIfNoDb = !DB_URL;

const SECRET = 'integration-test-secret';
const BANK_BIN = '970436';
const BANK_ACCOUNT = '9912780019';
const BANK_HOLDER = 'DAO QUYNH LE';

function stubSupabase(userId: string): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
            email: 'm3@example.com',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: new Date().toISOString(),
            role: 'authenticated'
          } as any
        },
        error: null
      })
    }
  } as unknown as SupabaseClient;
}

function buildApp(pool: Pool, userId: string) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).rawBody = req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0);
    next();
  });
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = Buffer.from(buf);
    }
  }));
  const billingEnabled = () => true;
  app.use('/api/v1/billing', createPaymentOrdersRouter({
    pool,
    supabase: stubSupabase(userId),
    bankBin: BANK_BIN,
    bankAccount: BANK_ACCOUNT,
    bankHolder: BANK_HOLDER,
    enabled: billingEnabled
  }));
  app.use('/api/v1/billing', createPaymentWebhookRouter({
    pool,
    bankAccount: BANK_ACCOUNT,
    webhookSecret: SECRET,
    enabled: billingEnabled
  }));
  return app;
}

function sign(body: string) {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
}

async function createUser(pool: Pool, email: string) {
  const u = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return u.rows[0].id;
}

async function deleteUserArtifacts(pool: Pool, userId: string) {
  await pool.query(`DELETE FROM subscription_events WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM user_subscriptions WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM payment_orders WHERE user_id = $1`, [userId]);
  // Clean unmatched events (no order) for this user; the
  // events are NOT linked to a user_id, so we delete by
  // received_at + signature_valid to keep the dev DB tidy.
  await pool.query(`DELETE FROM payment_events WHERE order_id IS NULL AND received_at < NOW() - INTERVAL '1 minute'`);
  await pool.query(`DELETE FROM user_entitlements WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
}

describe.skipIf(skipIfNoDb)('M3 VietQR + SePay webhook', () => {
  let pool: Pool;
  let userId: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    pool = createPool(DB_URL);
    userId = await createUser(pool, `m3-${Date.now()}@example.com`);
    app = buildApp(pool, userId);
  });

  beforeEach(async () => {
    // Reset the per-user state between tests so the entitlement
    // starts on `memory`.
    await pool.query(`DELETE FROM subscription_events WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_subscriptions WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM payment_orders WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_entitlements WHERE user_id = $1`, [userId]);
    await pool.query(`UPDATE user_entitlements SET plan_id='memory', family='memory', valid_until=NULL, semantic_search_enabled=FALSE, monthly_capture_limit=50 WHERE user_id=$1`, [userId]);
  });

  afterAll(async () => {
    if (!pool) return;
    await deleteUserArtifacts(pool, userId);
    await pool.end();
  });

  it('creates a mastery-monthly order with 29,000 VND and a MNX reference', async () => {
    const res = await request(app)
      .post('/api/v1/billing/orders')
      .set('authorization', 'Bearer fake')
      .send({ planId: 'mastery-monthly' });
    expect(res.status).toBe(201);
    const order = res.body.data.order;
    expect(order.amountVnd).toBe(29_000);
    expect(order.planId).toBe('mastery-monthly');
    expect(order.reference).toMatch(/^MNX[2-9A-HJ-NP-Z]{5}$/);
    expect(res.body.data.qr.payload.length).toBeGreaterThan(40);
    expect(res.body.data.qr.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(res.body.data.recipient.account).toBe(BANK_ACCOUNT);
  });

  it('creates a mastery-yearly order with 249,000 VND', async () => {
    const res = await request(app)
      .post('/api/v1/billing/orders')
      .set('authorization', 'Bearer fake')
      .send({ planId: 'mastery-yearly' });
    expect(res.status).toBe(201);
    expect(res.body.data.order.amountVnd).toBe(249_000);
  });

  it('webhook rejects an unsigned delivery with 401', async () => {
    const orderRes = await request(app)
      .post('/api/v1/billing/orders')
      .set('authorization', 'Bearer fake')
      .send({ planId: 'mastery-monthly' });
    const reference = orderRes.body.data.order.reference;
    const payload = JSON.stringify({
      id: 'tx-unsigned',
      accountNumber: BANK_ACCOUNT,
      content: `Mnemonics ${reference}`,
      amount: 29000,
      transferType: 'in'
    });
    const res = await request(app)
      .post('/api/v1/billing/webhooks/sepay')
      .set('content-type', 'application/json')
      .send(JSON.parse(payload));
    expect(res.status).toBe(401);
  });

  it('webhook accepts a signed delivery, marks order paid, activates mastery', async () => {
    const orderRes = await request(app)
      .post('/api/v1/billing/orders')
      .set('authorization', 'Bearer fake')
      .send({ planId: 'mastery-monthly' });
    const reference = orderRes.body.data.order.reference;
    const payload = JSON.stringify({
      id: 'tx-1',
      accountNumber: BANK_ACCOUNT,
      content: `Mnemonics ${reference}`,
      amount: 29000,
      transferType: 'in',
      transactionDate: '2026-10-12 13:45:00'
    });
    const res = await request(app)
      .post('/api/v1/billing/webhooks/sepay')
      .set('content-type', 'application/json')
      .set('x-sepay-signature', sign(payload))
      .send(JSON.parse(payload));
    expect(res.status).toBe(200);
    expect(res.body.data.activated).toBe(true);

    const ent = await getEntitlement(pool, userId);
    expect(ent.planId).toBe('mastery-monthly');
    expect(ent.family).toBe('mastery');
    expect(ent.semanticSearchEnabled).toBe(true);
    expect(ent.validUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000 - 60_000);
  });

  it('a duplicate webhook delivery is idempotent', async () => {
    const orderRes = await request(app)
      .post('/api/v1/billing/orders')
      .set('authorization', 'Bearer fake')
      .send({ planId: 'mastery-yearly' });
    const reference = orderRes.body.data.order.reference;
    const payload = JSON.stringify({
      id: 'tx-2',
      accountNumber: BANK_ACCOUNT,
      content: `Mnemonics ${reference}`,
      amount: 249000,
      transferType: 'in'
    });
    const first = await request(app)
      .post('/api/v1/billing/webhooks/sepay')
      .set('x-sepay-signature', sign(payload))
      .send(JSON.parse(payload));
    expect(first.status).toBe(200);
    expect(first.body.data.activated).toBe(true);

    const second = await request(app)
      .post('/api/v1/billing/webhooks/sepay')
      .set('x-sepay-signature', sign(payload))
      .send(JSON.parse(payload));
    expect(second.status).toBe(200);
    expect(second.body.data.idempotent).toBe(true);
    expect(second.body.data.activated).toBe(false);
  });

  it('a wrong-amount webhook is rejected and the order is not paid', async () => {
    const orderRes = await request(app)
      .post('/api/v1/billing/orders')
      .set('authorization', 'Bearer fake')
      .send({ planId: 'mastery-monthly' });
    const reference = orderRes.body.data.order.reference;
    const payload = JSON.stringify({
      id: 'tx-wrong',
      accountNumber: BANK_ACCOUNT,
      content: `Mnemonics ${reference}`,
      amount: 1,           // < 29_000
      transferType: 'in'
    });
    const res = await request(app)
      .post('/api/v1/billing/webhooks/sepay')
      .set('x-sepay-signature', sign(payload))
      .send(JSON.parse(payload));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AMOUNT_MISMATCH');

    const getRes = await request(app)
      .get(`/api/v1/billing/orders/${orderRes.body.data.order.id}`)
      .set('authorization', 'Bearer fake');
    expect(getRes.body.data.order.status).toBe('rejected');
  });

  it('a webhook for an unknown reference is recorded but does not 5xx', async () => {
    const payload = JSON.stringify({
      id: 'tx-unknown',
      accountNumber: BANK_ACCOUNT,
      content: 'Mnemonics MNXZZZZZ',
      amount: 29000,
      transferType: 'in'
    });
    const res = await request(app)
      .post('/api/v1/billing/webhooks/sepay')
      .set('x-sepay-signature', sign(payload))
      .send(JSON.parse(payload));
    expect(res.status).toBe(200);
    expect(res.body.data.note).toContain('unmatched');
  });

  it('cancelling a pending order flips it to cancelled', async () => {
    const orderRes = await request(app)
      .post('/api/v1/billing/orders')
      .set('authorization', 'Bearer fake')
      .send({ planId: 'mastery-monthly' });
    const orderId = orderRes.body.data.order.id;
    const cancel = await request(app)
      .post(`/api/v1/billing/orders/${orderId}/cancel`)
      .set('authorization', 'Bearer fake');
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.order.status).toBe('cancelled');
  });
});
