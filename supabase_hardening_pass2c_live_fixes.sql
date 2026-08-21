-- ============================================================================
-- FGBMFI EMS — SECURITY HARDENING PASS 2C (live-DB-only fixes, from schema dump)
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Source: live_schema_dump.txt (authoritative introspection, 2026-08-21).
-- Fixes discovered ONLY by inspecting the live DB (not present in repo files):
--
--   F1  v_auth_integrity_check (VIEW over auth.users) granted SELECT to anon +
--       authenticated. Views bypass RLS on base tables by default → any visitor
--       could read all auth.users emails + bcrypt costs. THIS is the root
--       "Exposed Auth Users" dashboard warning.
--   F2  chapters.authenticated_all [ALL USING true] defeats the Pass-1 admin-only
--       chapters_admin_* policies (permissive OR). Chapters still writable by
--       every authenticated user.
--   F3  session_response_summaries.srs_update AND session_voice_distribution.
--       svd_update are USING true/WITH CHECK true → any role (even finance)
--       can mutate ministry aggregates.
--   F4  update_auth_user_email(uuid, text) is SECURITY DEFINER with NO
--       is_admin_user() guard → any authenticated user could hijack any
--       account's email (account takeover vector).
--   F5  update_pledge_redemption(uuid, numeric) is SECURITY DEFINER with no
--       role gate → any authenticated user could inflate redemption amounts.
--   F6  search_delegates / search_delegates_with_checkin_status are SECURITY
--       DEFINER and UNUSED by the app; search_delegates' COUNT query ignores
--       p_event_id (cross-event leak) and bypasses RLS.
--   F7  get_dashboard_stats (legacy, unused) counts ALL delegates across events
--       (no event filter) and returns financials to any authenticated caller.
--   F8  badge_batches INSERT/UPDATE policies grant national/regional registrars
--       (Badge Printing is admin + event_admin only per route map).
--
-- Pass-1 (supabase_hardening_pass1.sql) applied cleanly and its guards/financial
-- gates ARE live (confirmed by function grants + policy dump). This pass closes
-- the gaps that live-DB inspection surfaced.
-- ============================================================================

-- ============================================================================
-- SECTION 1 — F1: seal v_auth_integrity_check (auth.users VIEW)
-- Only service_role / DB owners may read it (admin SQL-Editor usage).
-- ============================================================================
REVOKE ALL ON public.v_auth_integrity_check FROM anon;
REVOKE ALL ON public.v_auth_integrity_check FROM authenticated;
GRANT SELECT ON public.v_auth_integrity_check TO service_role;

-- ============================================================================
-- SECTION 2 — F2: drop chapters.authenticated_all (leaves only admin writes)
-- ============================================================================
DROP POLICY IF EXISTS "authenticated_all" ON chapters;
DROP POLICY IF EXISTS "chapters_insert" ON chapters;
DROP POLICY IF EXISTS "chapters_update" ON chapters;
DROP POLICY IF EXISTS "chapters_delete" ON chapters;

-- ============================================================================
-- SECTION 3 — F3: scope srs_update + svd_update to officer roles
-- (admins, event admins, and active registrars — matching srs_insert/svd_insert)
-- ============================================================================
DROP POLICY IF EXISTS "srs_update" ON session_response_summaries;
CREATE POLICY "srs_update" ON session_response_summaries FOR UPDATE TO authenticated
USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
             AND (is_active IS NULL OR is_active = true))
)
WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
             AND (is_active IS NULL OR is_active = true))
);

DROP POLICY IF EXISTS "svd_update" ON session_voice_distribution;
CREATE POLICY "svd_update" ON session_voice_distribution FOR UPDATE TO authenticated
USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
             AND (is_active IS NULL OR is_active = true))
)
WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
             AND (is_active IS NULL OR is_active = true))
);

-- ============================================================================
-- SECTION 4 — F4: guard update_auth_user_email (admins only)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_auth_user_email(user_id uuid, new_email text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  UPDATE auth.users SET
    email = new_email,
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    confirmation_sent_at = COALESCE(confirmation_sent_at, NOW()),
    confirmation_token = '',
    recovery_token = '',
    email_change_token = '',
    email_change = '',
    updated_at = NOW()
  WHERE id = user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
  END IF;

  RETURN json_build_object('status', 'success');
END;
$function$;

-- ============================================================================
-- SECTION 5 — F5: guard update_pledge_redemption (admin/event_admin/finance)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_pledge_redemption(p_pledge_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()
          OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
                     AND role = 'finance' AND (is_active IS NULL OR is_active = true))) THEN
    RAISE EXCEPTION 'FORBIDDEN: financial privileges required';
  END IF;

  UPDATE public.pledges
  SET amount_redeemed = amount_redeemed + p_amount
  WHERE id = p_pledge_id;
END;
$function$;

-- ============================================================================
-- SECTION 6 — F6: scope search_delegates* (unused by app; force event_id so a
-- direct RPC caller cannot leak cross-event data)
-- ============================================================================
CREATE OR REPLACE FUNCTION search_delegates(
  p_query text,
  p_event_id uuid,
  p_district_filter text DEFAULT NULL::text,
  p_session_id uuid DEFAULT NULL::uuid,
  p_page_size integer DEFAULT 50,
  p_page_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_results JSONB;
  v_total INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM delegates d
  WHERE d.event_id = p_event_id
    AND (d.first_name ILIKE '%' || p_query || '%'
         OR d.last_name ILIKE '%' || p_query || '%'
         OR d.phone ILIKE '%' || p_query || '%')
    AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)));

  SELECT JSONB_AGG(sub) INTO v_results
  FROM (
    SELECT d.*,
      CASE WHEN c.delegate_id IS NOT NULL THEN true ELSE false END AS "checkedIn",
      CASE WHEN c2.delegate_id IS NOT NULL THEN true ELSE false END AS "sessionCheckedIn"
    FROM delegates d
    LEFT JOIN (SELECT delegate_id FROM checkins WHERE event_id = p_event_id AND session_id IS NULL) c ON c.delegate_id = d.delegate_id
    LEFT JOIN (SELECT delegate_id FROM checkins WHERE event_id = p_event_id AND session_id = p_session_id) c2 ON c2.delegate_id = d.delegate_id
    WHERE d.event_id = p_event_id
      AND (d.first_name ILIKE '%' || p_query || '%'
           OR d.last_name ILIKE '%' || p_query || '%'
           OR d.phone ILIKE '%' || p_query || '%')
      AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
    ORDER BY d.last_name, d.first_name
    LIMIT p_page_size OFFSET p_page_offset
  ) sub;

  RETURN JSONB_BUILD_OBJECT(
    'delegates', COALESCE(v_results, '[]'::JSONB),
    'total', v_total,
    'page', p_page_offset / p_page_size + 1,
    'pageSize', p_page_size
  );
END;
$function$;

CREATE OR REPLACE FUNCTION search_delegates_with_checkin_status(
  p_query text,
  p_event_id uuid,
  p_district text DEFAULT NULL::text,
  p_session_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(delegate_id uuid, title text, first_name text, last_name text, name_display text, chapter text, district text, email text, phone text, rank text, office text, "checkedIn" boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT d.delegate_id, d.title, d.first_name, d.last_name, d.name_display,
         d.chapter, d.district, d.email, d.phone, d.rank, d.office,
         EXISTS (
           SELECT 1 FROM checkins c
           WHERE c.delegate_id = d.delegate_id AND c.event_id = p_event_id
             AND ((p_session_id IS NULL AND c.session_id IS NULL)
                  OR (p_session_id IS NOT NULL AND c.session_id = p_session_id))
         ) AS "checkedIn"
  FROM delegates d
  WHERE d.event_id = p_event_id
    AND (d.name_display ILIKE '%' || p_query || '%'
         OR d.phone ILIKE '%' || p_query || '%'
         OR d.chapter ILIKE '%' || p_query || '%')
    AND (p_district IS NULL OR d.district = p_district);
END;
$function$;

-- ============================================================================
-- SECTION 7 — F7: event-scope get_dashboard_stats + financial gate
-- (legacy RPC; used by NOTHING in the app, but keep it safe as defense-in-depth)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    result json;
    can_view_finance boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  can_view_finance := (is_admin_user() OR is_event_admin_user()
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)));

  SELECT json_build_object(
      'totalDelegates', (SELECT COUNT(*) FROM public.delegates WHERE event_id = p_event_id),
      'totalCheckIns', (SELECT COUNT(*) FROM public.checkins WHERE event_id = p_event_id AND session_id IS NULL),
      'totalSessionAttendance', (SELECT COUNT(*) FROM public.checkins WHERE event_id = p_event_id AND session_id IS NOT NULL),
      'totalFinancials', CASE WHEN can_view_finance
                           THEN (SELECT COALESCE(SUM(amount), 0) FROM public.financial_entries WHERE event_id = p_event_id)
                           ELSE 0 END,
      'checkInsByRank', (
          SELECT COALESCE(json_object_agg(rank, count), '{}'::json)
          FROM (
              SELECT d.rank, COUNT(c.checkin_id) as count
              FROM public.checkins c
              JOIN public.delegates d ON c.delegate_id = d.delegate_id
              WHERE c.event_id = p_event_id AND c.session_id IS NULL
              GROUP BY d.rank
          ) as rank_counts
      ),
      'checkInsByDistrict', (
          SELECT COALESCE(json_object_agg(district, count), '{}'::json)
          FROM (
              SELECT d.district, COUNT(c.checkin_id) as count
              FROM public.checkins c
              JOIN public.delegates d ON c.delegate_id = d.delegate_id
              WHERE c.event_id = p_event_id AND c.session_id IS NULL
              GROUP BY d.district
          ) as district_counts
      ),
      'recentActivity', (
          SELECT COALESCE(json_agg(row_to_json(recent_checkins)), '[]'::json)
          FROM (
              SELECT c.checked_in_at, d.name_display as delegate_name, d.district, d.rank
              FROM public.checkins c
              JOIN public.delegates d ON c.delegate_id = d.delegate_id
              WHERE c.event_id = p_event_id AND c.session_id IS NULL
              ORDER BY c.checked_in_at DESC
              LIMIT 5
          ) as recent_checkins
      )
  )
  INTO result;
  RETURN result;
END;
$function$;

-- ============================================================================
-- SECTION 8 — F8: badge_batches insert/update restricted to admin + event_admin
-- ============================================================================
DROP POLICY IF EXISTS "Admin can insert badge batches" ON badge_batches;
CREATE POLICY "Admin can insert badge batches" ON badge_batches FOR INSERT TO authenticated
WITH CHECK (
  is_admin_user() OR is_event_admin_user()
);

DROP POLICY IF EXISTS "Admin can update badge batches" ON badge_batches;
CREATE POLICY "Admin can update badge batches" ON badge_batches FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user())
WITH CHECK (is_admin_user() OR is_event_admin_user());

-- ============================================================================
-- SECTION 9 — VERIFICATION
-- ============================================================================

-- 9a. v_auth_integrity_check no longer readable by anon/authenticated
SELECT grantee::text, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'v_auth_integrity_check'
  AND grantee IN ('anon','authenticated')
ORDER BY grantee;

-- 9b. update_auth_user_email / update_pledge_redemption carry guards (visible in
--     pg_get_functiondef) and remain executable by authenticated only.
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('update_auth_user_email','update_pledge_redemption');

-- 9c. chapters no longer has an open ALL policy for authenticated
SELECT policyname, cmd, roles::text, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'chapters'
ORDER BY policyname;

-- 9d. srs_update / svd_update are now role-scoped
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('session_response_summaries','session_voice_distribution')
  AND policyname IN ('srs_update','svd_update');