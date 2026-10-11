-- 030_payment_orders.sql
-- Payment order state machine, provider event log, and
-- subscription transition audit trail.
--
-- Design notes:
--   * `payment_orders.reference` is a unique, 8-character
--     ASCII string (e.g. "MNX8K4P2Q") that the user copies
--     into the bank transfer description. The constraint
--     guarantees no two orders can collide.
--   * `payment_orders` is owned by the service-role pool —
--     RLS denies direct access from PostgREST. The API
--     serves a user-scoped view in M4.
--   * `payment_events.provider_txn_id` is the provider's own
--     transaction reference. The `UNIQUE (provider, provider_txn_id)`
--     constraint is the idempotency key for duplicate webhook
--     deliveries.
--   * `subscription_events` is an append-only audit log of
--     every plan transition. The admin dashboard reads it
--     alongside `role_audit_log`.

CREATE TABLE IF NOT EXISTS payment_orders (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id         TEXT         NOT NULL REFERENCES subscription_plans(id),
  amount_vnd      BIGINT       NOT NULL CHECK (amount_vnd > 0),
  reference       TEXT         NOT NULL UNIQUE,
  qr_payload      TEXT         NOT NULL,
  status          TEXT         NOT NULL CHECK (status IN ('pending','paid','expired','cancelled','rejected','refunded')),
  provider        TEXT         NULL,
  provider_txn_id TEXT         NULL,
  expires_at      TIMESTAMPTZ  NOT NULL,
  paid_at         TIMESTAMPTZ  NULL,
  note            TEXT         NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_orders_user_idx
  ON payment_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_orders_status_idx
  ON payment_orders (status, created_at DESC);

ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_orders_service_only ON payment_orders;
CREATE POLICY payment_orders_service_only ON payment_orders
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS payment_events (
  id                BIGSERIAL    PRIMARY KEY,
  order_id          BIGINT       NULL REFERENCES payment_orders(id) ON DELETE SET NULL,
  provider          TEXT         NOT NULL,
  provider_txn_id   TEXT         NULL,
  event_type        TEXT         NOT NULL,
  amount_vnd        BIGINT       NULL,
  reference         TEXT         NULL,
  raw_payload       JSONB        NOT NULL,
  signature_valid   BOOLEAN      NOT NULL,
  processed         BOOLEAN      NOT NULL DEFAULT FALSE,
  received_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ  NULL,
  note              TEXT         NULL,
  CONSTRAINT payment_events_provider_txn_unique UNIQUE (provider, provider_txn_id)
);

CREATE INDEX IF NOT EXISTS payment_events_unprocessed_idx
  ON payment_events (received_at) WHERE processed = FALSE;

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_events_service_only ON payment_events;
CREATE POLICY payment_events_service_only ON payment_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS subscription_events (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id     TEXT         NOT NULL,
  from_status TEXT         NULL,
  to_status   TEXT         NOT NULL,
  source      TEXT         NOT NULL CHECK (source IN ('payment','admin','system')),
  reference   TEXT         NULL,
  reason      TEXT         NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscription_events_user_idx
  ON subscription_events (user_id, created_at DESC);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_events_service_only ON subscription_events;
CREATE POLICY subscription_events_service_only ON subscription_events
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
