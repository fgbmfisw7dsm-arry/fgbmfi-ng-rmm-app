-- ============================================================================
-- v1.89a — PRE-EVENT VERIFICATION PROBES (READ-ONLY)
-- ----------------------------------------------------------------------------
-- Phase 0 of the concurrency/security remediation.
-- This file contains ONLY SELECT statements. It changes nothing.
-- Run it in the Supabase SQL editor and compare the output to the expectations
-- listed beside each query.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DEFINER inventory for the two RPCs under review
--    EXPECT after v1.89b:  get_paginated_delegates -> prosecdef = false
--                          get_event_export_data    -> NO ROW
-- ----------------------------------------------------------------------------
SELECT n.nspname                     AS schema,
       p.proname                     AS function_name,
       p.prosecdef                   AS is_security_definer,
       pg_get_function_identity_arguments(p.oid) AS args,
       (p.proconfig IS NOT NULL AND array_to_string(p.proconfig, ',') LIKE '%search_path%') AS has_search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_paginated_delegates', 'get_event_export_data', 'search_delegates_v2')
ORDER BY p.proname;

-- ----------------------------------------------------------------------------
-- 2. All public functions lacking an explicit search_path
--    EXPECT after v1.89d: zero rows
-- ----------------------------------------------------------------------------
SELECT p.proname                                        AS function_name,
       pg_get_function_identity_arguments(p.oid)         AS args,
       p.prosecdef                                      AS secdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prosecdef = true
  AND (p.proconfig IS NULL OR NOT (array_to_string(p.proconfig, ',') LIKE '%search_path%'))
ORDER BY p.proname;

-- ----------------------------------------------------------------------------
-- 3. Storage policies on the badge PDFs bucket
--    EXPECT after v1.89c: the INSERT/UPDATE/DELETE predicates reference
--    is_admin_user() / is_event_admin_user()
-- ----------------------------------------------------------------------------
SELECT policyname,
       cmd,
       roles::text          AS roles,
       qual                 AS using_expression,
       with_check           AS with_check_expression
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename  = 'objects'
  AND policyname LIKE '%badge_pdfs%'
ORDER BY policyname;

-- ----------------------------------------------------------------------------
-- 4. chapters policy target
--    EXPECT after v1.89f: chapters_select roles = {authenticated} (not {public})
-- ----------------------------------------------------------------------------
SELECT policyname, cmd, roles::text AS roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'chapters'
ORDER BY policyname;

-- ----------------------------------------------------------------------------
-- 5. Delegate protected-column guard
--    EXPECT after v1.89e: one row for trg_delegates_guard_critical
-- ----------------------------------------------------------------------------
SELECT t.tgname,
       p.proname,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c   ON c.oid = t.tgrelid
JOIN pg_proc  p   ON p.oid = t.tgfoid
WHERE c.relname = 'delegates'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- ----------------------------------------------------------------------------
-- 6. RLS sanity — every core table must have row level security enabled
--    EXPECT: rls_enabled = true for all rows
-- ----------------------------------------------------------------------------
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN ('events','delegates','sessions','checkins','pledges',
                    'financial_entries','app_users','system_settings',
                    'badge_batches','badge_print_logs','session_responses',
                    'session_response_summaries','session_voice_distribution',
                    'session_attendance_manual','audit_log','session_kicks','chapters')
ORDER BY c.relname;

-- ----------------------------------------------------------------------------
-- 7. Live smoke test for S1 (run as a NON-admin / district login, then again
--    as an admin; compare row counts).
--
--    With SECURITY DEFINER this returns EVERY delegate in the database for any
--    caller. After v1.89b (SECURITY INVOKER) a district user sees only their
--    district and an unprivileged role sees none.
--
--    NOTE: this is a read. It is included here for manual execution because the
--    result differs per login and cannot be demonstrated from the SQL editor
--    (which always runs as postgres).
-- ----------------------------------------------------------------------------
-- SELECT (get_paginated_delegates(1, 5, NULL, NULL, NULL, '<EVENT_UUID>', NULL, NULL))->>'total' AS total_visible;

-- ----------------------------------------------------------------------------
-- 8. Index coverage sanity for the 100-concurrent door path
--    EXPECT: qr_hash unique, checkins partial uniques, name_search/email trgm
-- ----------------------------------------------------------------------------
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('delegates','checkins','session_responses')
  AND (indexname LIKE '%qr_hash%'
    OR indexname LIKE '%arrival%'
    OR indexname LIKE '%unique%'
    OR indexname LIKE '%payment%')
ORDER BY tablename, indexname;
