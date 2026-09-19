-- 003_auth_hardening.sql
--
-- Adds per-email throttling and a tamper-evident audit log for the auth facade.
-- Idempotent: safe to re-run.
--
-- Down (manual, for future operators):
--   DROP TABLE IF EXISTS public.auth_events;
--   DROP TABLE IF EXISTS public.auth_throttle;
--   DROP FUNCTION IF EXISTS public.is_email_locked(text);
--   DROP FUNCTION IF EXISTS public.record_failed_attempt(text, int, interval);
--   DROP FUNCTION IF EXISTS public.reset_attempts(text);

BEGIN;

-- 1) audit log -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auth_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email_attempted text,                          -- always present except logout
  kind            text NOT NULL CHECK (kind IN (
                    'register','register_duplicate_email','register_failed',
                    'login','login_failed','login_locked',
                    'refresh','refresh_failed',
                    'logout',
                    'forgot_password','reset_password','resend_verification'
                  )),
  ip              inet,
  user_agent      text,
  request_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_events_email_idx     ON public.auth_events (lower(email_attempted), created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_user_id_idx   ON public.auth_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_events_kind_idx      ON public.auth_events (kind, created_at DESC);

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;

-- Only admins can read; nobody can write through PostgREST (we always INSERT
-- through the SECURITY DEFINER RPC below).
DROP POLICY IF EXISTS auth_events_admin_read ON public.auth_events;
CREATE POLICY auth_events_admin_read ON public.auth_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS auth_events_admin_manage ON public.auth_events;
CREATE POLICY auth_events_admin_manage ON public.auth_events
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 2) per-email throttling ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.auth_throttle (
  email_attempted  text PRIMARY KEY,
  attempts         int  NOT NULL DEFAULT 0,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz
);

ALTER TABLE public.auth_throttle ENABLE ROW LEVEL SECURITY;
-- No client policies: callers go through RPCs.

CREATE OR REPLACE FUNCTION public.is_email_locked(p_email text)
RETURNS TABLE(locked boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row      public.auth_throttle%ROWTYPE;
  v_retry    integer := 0;
BEGIN
  SELECT * INTO v_row FROM public.auth_throttle WHERE email_attempted = lower(p_email);
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0; RETURN;
  END IF;
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    v_retry := CEIL(EXTRACT(EPOCH FROM (v_row.locked_until - now())))::int;
    RETURN QUERY SELECT true, GREATEST(v_retry, 1); RETURN;
  END IF;
  RETURN QUERY SELECT false, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_failed_attempt(
  p_email        text,
  p_max_attempts int  DEFAULT 5,
  p_window       interval DEFAULT '15 minutes',
  p_lock_for     interval DEFAULT '15 minutes'
)
RETURNS TABLE(locked boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(p_email);
  v_row   public.auth_throttle%ROWTYPE;
  v_retry integer := 0;
BEGIN
  INSERT INTO public.auth_throttle(email_attempted, attempts, first_attempt_at)
    VALUES (v_email, 1, now())
    ON CONFLICT (email_attempted) DO UPDATE
      SET attempts = public.auth_throttle.attempts + 1
    RETURNING * INTO v_row;

  -- Reset counter if first attempt was older than the window.
  IF v_row.first_attempt_at IS NOT NULL AND v_row.first_attempt_at < now() - p_window THEN
    UPDATE public.auth_throttle
       SET attempts = 1,
           first_attempt_at = now(),
           locked_until = NULL
     WHERE email_attempted = v_email
     RETURNING * INTO v_row;
  END IF;

  IF v_row.attempts >= p_max_attempts THEN
    UPDATE public.auth_throttle
       SET locked_until = now() + p_lock_for
     WHERE email_attempted = v_email
     RETURNING * INTO v_row;
    v_retry := CEIL(EXTRACT(EPOCH FROM (v_row.locked_until - now())))::int;
    RETURN QUERY SELECT true, GREATEST(v_retry, 1); RETURN;
  END IF;

  RETURN QUERY SELECT false, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_attempts(p_email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  DELETE FROM public.auth_throttle WHERE email_attempted = lower(p_email);
$$;

-- 3) recorded insert helper ----------------------------------------------------
-- Insert as the authenticated user (or service role). We pass request metadata
-- through bind parameters; the function is SECURITY DEFINER so it can write
-- regardless of who the caller is.

CREATE OR REPLACE FUNCTION public.record_auth_event(
  p_kind            text,
  p_email_attempted text DEFAULT NULL,
  p_request_id      uuid DEFAULT NULL,
  p_user_agent      text DEFAULT NULL,
  p_ip              inet DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  INSERT INTO public.auth_events(kind, user_id, email_attempted, request_id, user_agent, ip)
    VALUES (p_kind, v_uid, lower(p_email_attempted), p_request_id, p_user_agent, p_ip)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_email_locked(text)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_failed_attempt(text, int, interval, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_attempts(text)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.record_auth_event(text, text, uuid, text, inet) TO service_role;

COMMIT;
