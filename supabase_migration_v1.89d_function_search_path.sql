-- ============================================================================
-- v1.89d — FUNCTION SEARCH_PATH HARDENING (S4)
-- ----------------------------------------------------------------------------
-- PROBLEM
--   16 SECURITY DEFINER functions in `public` had no explicit `search_path`.
--   A DEFINER function runs with the owner's privileges, so an unqualified
--   object reference is resolved against the CALLER's search_path. If an
--   attacker could create objects in a schema that precedes `public`, they could
--   shadow a table or helper function and have it executed as the owner
--   (classic search_path privilege escalation). Supabase's own linter reports
--   this as "Function Search Path Mutable".
--
-- FIX
--   Pin `search_path = public, pg_temp` on each reviewed function. `pg_temp` is
--   placed LAST so a temp table can never shadow a real one. Signatures are
--   resolved from the catalog, so this cannot fail on an argument mismatch and
--   cannot accidentally create a new overload.
--
-- SCOPE
--   Only the functions identified in the v1.89 review are touched. Any function
--   not named here keeps its current configuration.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  v_targets TEXT[] := ARRAY[
    'create_app_user',
    'delete_app_user',
    'reset_user_password',
    'deactivate_app_user',
    'reactivate_app_user',
    'deactivate_all_event_users',
    'get_auth_user_role',
    'auto_confirm_user',
    'check_login_account',
    'is_admin_user',
    'current_user_district',
    'current_user_region',
    'is_national_role_user',
    'is_registrar_user',
    'get_delegate_type_district'
  ];
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname = ANY (v_targets)
      AND (
        p.proconfig IS NULL
        OR NOT (array_to_string(p.proconfig, ',') LIKE '%search_path%')
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
      r.proname, r.args
    );
    v_count := v_count + 1;
    RAISE NOTICE 'search_path pinned: %(%)', r.proname, r.args;
  END LOOP;
  RAISE NOTICE 'v1.89d: % function(s) hardened', v_count;
END $$;

-- ============================================================================
-- VERIFICATION (read-only)
-- ============================================================================
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.prosecdef = true
--   AND (p.proconfig IS NULL OR NOT (array_to_string(p.proconfig, ',') LIKE '%search_path%'))
-- ORDER BY p.proname;
-- -- expect: zero rows
--
-- Smoke test that the auth helpers still resolve (run as any signed-in user):
-- SELECT is_admin_user(), current_user_district(), current_user_region();
-- ============================================================================
