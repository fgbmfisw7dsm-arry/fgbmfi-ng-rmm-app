-- ============================================================================
-- FGBMFI EMS — SECURITY HARDENING PASS 2A (orphan table cleanup)
-- Identify and remove legacy tables in the live DB that are not referenced
-- anywhere in the codebase and have RLS disabled.
--
-- Two known orphans (verified absent from repo + all migrations):
--   * public.financials           — legacy financial table (superseded by
--                                   financial_entries). Confirmed EMPTY.
--   * public.event_delegate_codes — legacy per-delegate code table (predates the
--                                   deterministic-code scheme, itself removed in
--                                   v1.10 for UUID-only qr_hash). RLS DISABLED.
--
-- Run the PRE-CHECK queries first; only run the ACTION section once confirmed.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PRE-CHECK 1: confirm both orphans are empty (expect 0 / 0)
-- ----------------------------------------------------------------------------
SELECT 'public.financials' AS tbl, COUNT(*) AS row_count FROM public.financials
UNION ALL
SELECT 'public.event_delegate_codes' AS tbl, COUNT(*) AS row_count FROM public.event_delegate_codes;

-- ----------------------------------------------------------------------------
-- PRE-CHECK 1b (event_delegate_codes only): peek at schema + a few rows if any
-- ----------------------------------------------------------------------------
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'event_delegate_codes'
ORDER BY ordinal_position;

-- If it unexpectedly has rows, inspect before deciding:
SELECT * FROM public.event_delegate_codes LIMIT 10;

-- ----------------------------------------------------------------------------
-- PRE-CHECK 2: any other public tables with RLS disabled?
-- (Target: NOT rowsecurity should only show tables you intentionally leave open)
-- ----------------------------------------------------------------------------
SELECT schemaname || '.' || tablename AS table_name, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity, tablename;

-- ----------------------------------------------------------------------------
-- PRE-CHECK 3: any remaining auth-schema grants to anon/authenticated/public?
-- (Target: no rows)
-- ----------------------------------------------------------------------------
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'auth'
  AND grantee IN ('anon', 'authenticated', 'public')
ORDER BY table_name, grantee;

-- ----------------------------------------------------------------------------
-- ACTION (run AFTER pre-checks):
-- 1. Drop public.financials (confirmed empty, unreferenced).
-- 2. Drop public.event_delegate_codes ONLY if empty; otherwise ENABLE RLS as a
--    safety net so anon can no longer read it until a human decides its fate.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.financials;

DO $$
DECLARE
    v_rows BIGINT;
BEGIN
    EXECUTE 'SELECT COUNT(*) FROM public.event_delegate_codes' INTO v_rows;
    IF v_rows = 0 THEN
        EXECUTE 'DROP TABLE IF EXISTS public.event_delegate_codes';
        RAISE NOTICE 'event_delegate_codes was empty — dropped.';
    ELSE
        EXECUTE 'ALTER TABLE public.event_delegate_codes ENABLE ROW LEVEL SECURITY';
        RAISE NOTICE 'event_delegate_codes has % rows — RLS enabled as safety net, NOT dropped. Human decision required.', v_rows;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- VERIFY: no RLS-off public tables remain (excluding intentionally-open ones)
-- ----------------------------------------------------------------------------
SELECT schemaname || '.' || tablename AS table_name, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity
ORDER BY tablename;
-- Target result: empty (or only tables you intentionally leave open).