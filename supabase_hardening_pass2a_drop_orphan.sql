-- ============================================================================
-- FGBMFI EMS — SECURITY HARDENING PASS 2A (orphan table cleanup)
-- Identify and remove legacy tables in the live DB that are not referenced
-- anywhere in the codebase and have RLS disabled.
--
-- Two known orphans (verified absent from repo + all migrations):
--   * public.financials           — legacy financial table (superseded by
--                                   financial_entries). DROPPED (confirmed empty).
--   * public.event_delegate_codes — legacy per-delegate 4-digit check-in code
--                                   table, retired in v1.10 for UUID-only
--                                   qr_hash. DROP DECISION DEFERRED; quarantined
--                                   with RLS + admin-only read in the ACTION.
--
-- Robust to both tables already being gone (to_regclass-guarded).
-- Run the PRE-CHECK first; the ACTION section is safe regardless.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PRE-CHECK 1: row counts for both orphans (any missing table reports 'already gone')
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_rows BIGINT;
BEGIN
    IF to_regclass('public.financials') IS NOT NULL THEN
        EXECUTE 'SELECT COUNT(*) FROM public.financials' INTO v_rows;
        RAISE NOTICE 'public.financials rows = %', v_rows;
    ELSE
        RAISE NOTICE 'public.financials — already gone (OK)';
    END IF;

    IF to_regclass('public.event_delegate_codes') IS NOT NULL THEN
        EXECUTE 'SELECT COUNT(*) FROM public.event_delegate_codes' INTO v_rows;
        RAISE NOTICE 'public.event_delegate_codes rows = %', v_rows;
    ELSE
        RAISE NOTICE 'public.event_delegate_codes — already gone (OK)';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- PRE-CHECK 1b (event_delegate_codes only): schema + sample, if it still exists
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r record;
    s record;
BEGIN
    IF to_regclass('public.event_delegate_codes') IS NOT NULL THEN
        RAISE NOTICE 'event_delegate_codes columns:';
        FOR r IN
            SELECT column_name || ' ' || data_type AS col
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'event_delegate_codes'
            ORDER BY ordinal_position
        LOOP
            RAISE NOTICE '  %', r.col;
        END LOOP;
        RAISE NOTICE 'event_delegate_codes sample:';
        FOR s IN
            SELECT row_to_json(t)::text AS js
            FROM (SELECT * FROM public.event_delegate_codes LIMIT 10) t
        LOOP
            RAISE NOTICE '  %', s.js;
        END LOOP;
    ELSE
        RAISE NOTICE 'event_delegate_codes — already gone (OK)';
    END IF;
END $$;

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
-- ACTION (safe to run even if one table is already gone):
-- 1. Drop public.financials if present (confirmed empty, unreferenced).
-- 2. public.event_delegate_codes — DROP DECISION DEFERRED (confirmed as the
--    retired 4-digit check-in code table, superseded by UUID-only qr_hash in
--    v1.10). It is quarantined here: RLS ENABLED as a safety net so the anon
--    role can no longer read it. Revisit for archive/keep/drop in a later pass.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.financials;

DO $$
BEGIN
    IF to_regclass('public.event_delegate_codes') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.event_delegate_codes ENABLE ROW LEVEL SECURITY';
        EXECUTE 'DROP POLICY IF EXISTS event_delegate_codes_admin_read ON event_delegate_codes';
        EXECUTE 'CREATE POLICY event_delegate_codes_admin_read ON event_delegate_codes FOR SELECT TO authenticated USING (is_admin_user())';
        RAISE NOTICE 'event_delegate_codes — RLS enabled + admin-only read (quarantine). Drop decision deferred to a later pass.';
    ELSE
        RAISE NOTICE 'event_delegate_codes — already gone (OK).';
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