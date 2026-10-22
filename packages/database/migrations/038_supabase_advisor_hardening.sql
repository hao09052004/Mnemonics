-- 038_supabase_advisor_hardening.sql
--
-- Fixes 4 Critical security issues detected by Supabase Security Advisor:
-- 1. Enable RLS on public.subscription_plans and allow public read for active plans
-- 2. Enable RLS on public.schema_migrations and restrict to service_role (if present)
-- 3. Set security_invoker = true on public.item_embeddings_real
-- 4. Set security_invoker = true on public.item_document_chunks_real

-- 1. subscription_plans RLS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'subscription_plans') THEN
    ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow public read on active subscription plans" ON public.subscription_plans;
    CREATE POLICY "Allow public read on active subscription plans"
      ON public.subscription_plans
      FOR SELECT
      TO public
      USING (is_active = TRUE);
  END IF;
END $$;

-- 2. schema_migrations RLS (present in Supabase Cloud managed projects)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations') THEN
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow service_role on schema_migrations" ON public.schema_migrations;
    CREATE POLICY "Allow service_role on schema_migrations"
      ON public.schema_migrations
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 3. item_embeddings_real security_invoker
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'item_embeddings_real') THEN
    ALTER VIEW public.item_embeddings_real SET (security_invoker = true);
  END IF;
END $$;

-- 4. item_document_chunks_real security_invoker
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'item_document_chunks_real') THEN
    ALTER VIEW public.item_document_chunks_real SET (security_invoker = true);
  END IF;
END $$;
