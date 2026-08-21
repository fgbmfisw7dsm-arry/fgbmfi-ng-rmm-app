-- ============================================================================
-- FGBMFI EMS — SECURITY HARDENING PASS 2A (orphan table cleanup)
-- Run the PRE-CHECK queries first; only run the DROP once confirmed safe.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PRE-CHECK 1: orphan table must be empty (expect 0)
-- ----------------------------------------------------------------------------
SELECT 'public.financials' AS tbl, COUNT(*) AS row_count
FROM public.financials;

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
-- ACTION (run AFTER all three pre-checks pass):
-- Drop the orphan 'financials' table. It is not referenced by any app code,
-- services, or RLS policies (all code uses financial_entries).
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.financials;

-- ----------------------------------------------------------------------------
-- VERIFY: orphan gone; any remaining rows in financial_entries are the real data
-- ----------------------------------------------------------------------------
SELECT schemaname || '.' || tablename AS table_name
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'financials';
-- Expected: 0 rows above (table no longer exists).