# M3 — VietQR Payments

> **Goal:** Add a server-side payment-order state machine,
> dynamic VietQR generation, a SePay-compatible webhook
> adapter with signature verification, and subscription
> activation/expiration on verified payment.

**Architecture:**

- New table `payment_orders` (id, user_id, plan_id, interval,
  amount_vnd, reference, qr_payload, status, expires_at, paid_at,
  provider, provider_txn_id, note).
- New table `payment_events` (id, order_id, provider, event_type,
  raw_payload jsonb, signature_valid, processed_at, note). One
  row per provider webhook delivery; `UNIQUE(provider, provider_txn_id)`
  makes duplicate deliveries idempotent.
- New table `subscription_events` (id, user_id, plan_id, from_status,
  to_status, source, reason, created_at). Append-only audit log of
  subscription transitions.
- New module `apps/api/src/payments/`:
  - `orders.ts` — createOrder, markPaid, markExpired.
  - `vietqr.ts` — build the dynamic QR payload (NAPAS 247
    format) for a given order. Uses a constant recipient from
    env (`PAYMENT_BANK_BIN`, `PAYMENT_BANK_ACCOUNT`,
    `PAYMENT_BANK_HOLDER`).
  - `providers/sepay.ts` — verify webhook signature, parse
    the inbound payload, normalise to `PaymentEvent`.
  - `webhook.ts` — the route handler. Idempotent, transactional.
- `applyEntitlement` (already in M2) is called by the webhook
  after the order is marked `paid`.
- New route `apps/api/src/routes/payment-orders.ts`:
  - `POST /api/v1/billing/orders` (auth) — create a pending order
    + return the dynamic QR.
  - `GET  /api/v1/billing/orders/:id` (auth) — current order
    state (UI polls this).
  - `GET  /api/v1/billing/orders` (auth) — the caller's history.
  - `POST /api/v1/billing/orders/:id/cancel` (auth) — only `pending`
    orders; idempotent.
  - `POST /api/v1/billing/webhooks/:provider` — public, but
    signature-protected.
- A billing-flag guard: if `BILLING_ENABLED !== 'true'`, the
  routes return 503. This is the feature flag for production.

## Task 1 — Migration: payment tables

**File:** `packages/database/migrations/030_payment_orders.sql`

```sql
CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  reference TEXT NOT NULL UNIQUE,           -- e.g. "MNX8K4P2Q"
  qr_payload TEXT NOT NULL,                -- the raw VietQR text
  status TEXT NOT NULL CHECK (status IN ('pending','paid','expired','cancelled','rejected','refunded')),
  provider TEXT NULL,
  provider_txn_id TEXT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON payment_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_status_idx ON payment_orders (status, created_at DESC);

ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_orders_service_only ON payment_orders;
CREATE POLICY payment_orders_service_only ON payment_orders
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NULL REFERENCES payment_orders(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_txn_id TEXT NULL,
  event_type TEXT NOT NULL,                 -- 'payment.in' | 'payment.out' | 'unknown'
  amount_vnd BIGINT NULL,
  reference TEXT NULL,
  raw_payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  note TEXT NULL,
  UNIQUE (provider, provider_txn_id)
);

CREATE INDEX IF NOT EXISTS payment_events_unprocessed_idx
  ON payment_events (received_at) WHERE processed = FALSE;

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_events_service_only ON payment_events;
CREATE POLICY payment_events_service_only ON payment_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  from_status TEXT NULL,
  to_status TEXT NOT NULL,
  source TEXT NOT NULL,                    -- 'payment' | 'admin' | 'system'
  reference TEXT NULL,                     -- order reference
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscription_events_user_idx
  ON subscription_events (user_id, created_at DESC);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_events_service_only ON subscription_events;
CREATE POLICY subscription_events_service_only ON subscription_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
```

**Step 1.1: Apply**

```bash
pnpm --filter @mnemonics/api exec tsx scripts/apply-one-migration.mts 030_payment_orders.sql
```

## Task 2 — VietQR builder

**File:** `apps/api/src/payments/vietqr.ts`

The VietQR text format used by Vietnamese banks is a structured
URL-style string. The builder constructs it from the
recipient (BIN/account/holder) and the order's amount and
reference. The exact field layout is fixed by the VietQR
spec; for the demo we use a documented format that all major
Vietnamese banking apps accept.

```ts
export interface VietQrInput {
  bankBin: string;          // 970436
  bankAccount: string;      // 9912780019
  bankHolder: string;       // DAO QUYNH LE
  amountVnd: number;
  reference: string;        // MNX8K4P2Q
  description: string;
}

export function buildVietQrPayload(input: VietQrInput): string {
  // 1. Merchant account info (tag 38) — encoded as a sub-TLV
  //    block: GUID, BIN, account, holder (we use the simple
  //    field set documented by the v1 VietQR consumer spec).
  // 2. Transaction currency (tag 53) = 704 (VND).
  // 3. Transaction amount (tag 54) = amountVnd.
  // 4. Country code (tag 58) = VN.
  // 5. Merchant name (tag 59) = bankHolder.
  // 6. Additional data (tag 62) = "QRN" sub-tag + reference.
  // 7. CRC-16/CCITT on the entire string, prepended with
  //    "6304" + 4 hex digits.
  // The function returns a single string the QR encoder can
  // render directly.
  ...
}
```

For the M3 demo we ship a minimal but valid NAPAS-247
payload. The QR image is generated server-side via the
`qrcode` package (added to dependencies).

## Task 3 — Order + webhook logic

**File:** `apps/api/src/payments/orders.ts`

```ts
export async function createOrder(pool, args: {
  userId: string;
  planId: PlanId;
}): Promise<PaymentOrder>

export async function markOrderPaid(pool, args: {
  orderId: bigint;
  provider: string;
  providerTxnId: string;
  paidAt: Date;
}): Promise<PaymentOrder>

export async function markOrderExpired(pool, args: { orderId: bigint }): Promise<void>
```

The function:
- generates a unique 8-character ASCII reference (`MNX######`),
- builds the VietQR payload,
- inserts the order with `status = 'pending'` and `expires_at = now() + 30 min`,
- returns the order including the QR payload (and the base64 PNG).

The expiry is re-checked at read time so an order that was
never paid can transition to `expired` either by a cron
sweep or by the next `getOrder` call.

## Task 4 — SePay adapter

**File:** `apps/api/src/payments/providers/sepay.ts`

The adapter normalises SePay's documented webhook shape to a
common event. It does NOT trust any field other than the
signature.

The signature is computed as:
```
signature = hmac_sha256(SEPAY_WEBHOOK_SECRET, raw_body)
header    = "x-sepay-signature: <hex>"
```

The verifier compares the header value (constant-time) to
the computed signature. If the env variable is missing the
adapter REFUSES to start — the webhook returns 503.

## Task 5 — Webhook route

**File:** `apps/api/src/routes/payment-webhook.ts`

```ts
router.post('/webhooks/:provider', async (req, res) => {
  if (!BILLING_ENABLED) return 503;
  const adapter = getAdapter(req.params.provider);
  if (!adapter) return 404;
  const raw = (req as any).rawBody?.toString() ?? '';
  const sig = req.header(adapter.signatureHeader);
  if (!adapter.verifySignature(raw, sig)) {
    // Record the rejected event in `payment_events` for the
    // admin to inspect.
    return 401;
  }
  const event = adapter.parse(raw);
  // Insert into `payment_events` with the unique (provider,
  // provider_txn_id) constraint. On conflict, the existing
  // row is returned; we never re-apply.
  ...
  // Match the event against a `pending` order by reference.
  // Verify amount, beneficiary. Mark paid, activate
  // subscription.
});
```

## Task 6 — Tests

- `vietqr.test.ts` — round-trip: the builder produces a
  parseable NAPAS-247 string with the right amount,
  reference, and CRC.
- `orders.test.ts` — order creation, uniqueness, expiry.
- `webhook-sepay.test.ts` — valid signature → order paid →
  entitlement upgraded. Invalid signature → 401. Duplicate
  delivery → idempotent. Wrong amount → rejected.

## Task 7 — Commit

```bash
git add -A
git commit -m "feat(billing): M3 VietQR + SePay webhook + subscription activation"
```

— end of M3 plan —
