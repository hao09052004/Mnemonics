-- 034_payment_orders_payos.sql
-- Switch the M3 payment-order schema from "VietQR + SePay"
-- (where the backend builds the QR string and SePay reports
-- inbound transfers) to "PayOS checkout" (where PayOS
-- hosts the payment page and reports via webhook).
--
-- Schema changes:
--   * `order_code` (BIGINT) — the integer PayOS uses to
--     identify a payment request. Unique per merchant. The
--     webhook uses this to find the matching order.
--   * `checkout_url` (TEXT) — the PayOS-hosted URL the
--     frontend redirects the user to.
--   * `qr_payload` is dropped (PayOS renders its own QR;
--     we never build EMV NAPAS-247 strings anymore).
--
-- Backwards compatibility:
--   * Existing rows from pre-PayOS deployments have
--     `qr_payload` data we no longer need. We DROP COLUMN
--     with no backfill — orders that are still `pending`
--     will be cancelled by the operator (see the operator
--     runbook in docs/billing-system.md#m3-migration).
--   * `reference` is kept and used as the MNX tag in the
--     PayOS `description` so the webhook parser can match
--     the inbound event back to a `payment_orders` row even
--     if `order_code` was missing or stripped by a proxy.

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS order_code BIGINT;

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS checkout_url TEXT;

-- PayOS orderCode is unique per merchant. Add a UNIQUE
-- index, but only on rows that have one (pre-existing
-- orders may have NULL).
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_order_code_unique
  ON payment_orders (order_code)
  WHERE order_code IS NOT NULL;

-- Drop the no-longer-needed qr_payload column. The
-- dynamic QR is now hosted by PayOS; we never build it
-- in this codebase anymore.
ALTER TABLE payment_orders
  DROP COLUMN IF EXISTS qr_payload;

-- Loosen the `reference` uniqueness: under the VietQR
-- model it was the only outbound identifier, but with
-- PayOS we have `order_code` as the canonical key.
-- Keep the UNIQUE constraint as a defence-in-depth to
-- prevent accidental reuse.
-- (No change — the existing UNIQUE on `reference` stays.)
