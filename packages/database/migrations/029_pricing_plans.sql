-- 029_pricing_plans.sql
-- Pricing & subscription tables for the Memory / Mastery plans.
--
-- Design notes:
--   * `subscription_plans` is the catalog (memory, mastery-monthly,
--     mastery-yearly). Prices are stored in integer VND; we never
--     use FLOAT for money.
--   * `user_subscriptions` records every plan change. The partial
--     unique index `user_subscriptions_one_active_per_user` ensures
--     each user has AT MOST one active subscription at a time.
--   * `user_entitlements` is the read-side projection used by
--     hot-path checks (capture limit, semantic search). One row
--     per user; refreshed by the API whenever a subscription
--     transitions.
--   * The 50 captures/month cap is enforced inside the items
--     insert transaction by `enforce_capture_limit(p_user_id)`.
--     A Mastery plan has `monthly_capture_limit = NULL` (no cap).
--   * The default entitlement for a new user is `memory` (free,
--     50/month, no semantic search). The trigger
--     `handle_new_user_entitlement` is the single source of that
--     default; the API never inserts a default entitlement row.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                       TEXT PRIMARY KEY,
  display_name             TEXT NOT NULL,
  family                   TEXT NOT NULL CHECK (family IN ('memory','mastery')),
  interval                 TEXT NOT NULL CHECK (interval IN ('forever','month','year')),
  amount_vnd               BIGINT NOT NULL CHECK (amount_vnd >= 0),
  monthly_capture_limit    INT NULL,             -- NULL = unlimited
  semantic_search_enabled  BOOLEAN NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO subscription_plans
  (id, display_name, family, interval, amount_vnd, monthly_capture_limit, semantic_search_enabled)
VALUES
  ('memory',          'Memory',                 'memory',  'forever', 0,      50,   FALSE),
  ('mastery-monthly', 'Mastery (Monthly)',      'mastery', 'month',   29000,  NULL, TRUE),
  ('mastery-yearly',  'Mastery (Yearly)',       'mastery', 'year',    249000, NULL, TRUE)
ON CONFLICT (id) DO NOTHING;

-- One active subscription per user. Other status values can stack
-- in history rows; only `active` is unique.
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id            BIGSERIAL    PRIMARY KEY,
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id       TEXT         NOT NULL REFERENCES subscription_plans(id),
  status        TEXT         NOT NULL CHECK (status IN ('pending','active','expired','cancelled','refunded')),
  period_start  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  period_end    TIMESTAMPTZ  NULL,
  source        TEXT         NOT NULL DEFAULT 'system' CHECK (source IN ('system','payment','admin_adjust','bootstrap')),
  note          TEXT         NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_one_active_per_user
  ON user_subscriptions (user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS user_subscriptions_user_idx
  ON user_subscriptions (user_id, status, created_at DESC);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_subscriptions_service_only ON user_subscriptions;
CREATE POLICY user_subscriptions_service_only ON user_subscriptions
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- Read-side projection. One row per user. The API keeps this
-- table consistent with `user_subscriptions` via `applyEntitlement`.
CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id                  UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id                  TEXT         NOT NULL,
  family                   TEXT         NOT NULL CHECK (family IN ('memory','mastery')),
  valid_until              TIMESTAMPTZ  NULL,        -- NULL = forever (memory)
  semantic_search_enabled  BOOLEAN      NOT NULL,
  monthly_capture_limit    INT          NULL,        -- NULL = unlimited
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_entitlements_self_read ON user_entitlements;
CREATE POLICY user_entitlements_self_read ON user_entitlements
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Trigger: every new user starts on the `memory` plan.
CREATE OR REPLACE FUNCTION public.handle_new_user_entitlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_entitlements
    (user_id, plan_id, family, valid_until, semantic_search_enabled, monthly_capture_limit)
  VALUES (NEW.id, 'memory', 'memory', NULL, FALSE, 50)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS handle_new_user_entitlement ON auth.users;
CREATE TRIGGER handle_new_user_entitlement
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_entitlement();

-- Backfill: insert the default entitlement for any existing
-- user that does not already have one. Safe to re-run.
INSERT INTO public.user_entitlements (user_id, plan_id, family, valid_until, semantic_search_enabled, monthly_capture_limit)
SELECT u.id, 'memory', 'memory', NULL, FALSE, 50
  FROM auth.users u
  LEFT JOIN public.user_entitlements e ON e.user_id = u.id
  WHERE e.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- Atomic 50/month cap. Called inside the items insert
-- transaction. Throws `CAPTURE_LIMIT_REACHED` when the user
-- is on the `memory` plan and has already used the month's
-- quota. The application maps this to a 402 response.
CREATE OR REPLACE FUNCTION public.enforce_capture_limit(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_limit      INT;
  v_count      INT;
  v_month_start TIMESTAMPTZ := date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh');
BEGIN
  SELECT monthly_capture_limit INTO v_limit
    FROM public.user_entitlements
   WHERE user_id = p_user_id;
  IF v_limit IS NULL THEN
    RETURN;  -- unlimited (mastery)
  END IF;
  SELECT count(*) INTO v_count
    FROM public.items
   WHERE user_id = p_user_id
     AND created_at >= v_month_start;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'CAPTURE_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            DETAIL = format('user=%s used=%s limit=%s', p_user_id, v_count, v_limit);
  END IF;
END;
$$;
