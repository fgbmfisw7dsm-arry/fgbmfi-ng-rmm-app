-- ============================================================================
-- FGBMFI EMS — HARDENING PASS 4: server-side role scope inside DEFINER aggregates
-- ----------------------------------------------------------------------------
-- Closes the residual data-exposure gap from pass 3: these SECURITY DEFINER
-- aggregates bypass RLS, so a district registrar calling them directly still
-- read national totals / raw alter-call records:
--   * get_event_dashboard_stats      (3-arg: p_event_id, p_district, p_region)
--   * get_report_aggregates          (2-arg: p_event_id, p_session_id)
--   * get_ministry_export_data       (1-arg: p_event_id)  [per-delegate PII]
--   * session_responses.sr_select    (was USING true for all authenticated)
--
-- The functions compute the CALLER's visible scope from auth.uid() using the
-- pass-3 helpers and clamp any client-supplied filter to it. Behaviour for
-- unscoped callers (admins, event_admin, finance, executive_admin,
-- exec_registrar, national roles) is byte-for-byte identical to today;
-- district/regional registrars see only their own district/region — identical
-- to the pass-3 delegates RLS, and a scoped-tier caller with no configured
-- district/region fails CLOSED (empty result), never open.
--
-- Frontend requires NO change (signatures are unchanged). Idempotent.
-- Run in Supabase SQL Editor AFTER supabase_hardening_pass3_rls_roles.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION district_key(p_district TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $function$
  SELECT UPPER(regexp_replace(TRIM($1), '\s+', ' ', 'g'));
$function$;

-- TRUE when the caller sees the FULL event (admins, event_admin, national
-- scope roles, finance, executive_admin). Matches getScopeFilter's unscoped set.
CREATE OR REPLACE FUNCTION caller_full_scope()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT is_admin_user()
      OR is_event_admin_user()
      OR is_national_role_user()
      OR EXISTS (
          SELECT 1 FROM app_users
          WHERE id = auth.uid()
            AND role IN ('finance','executive_admin')
            AND (is_active IS NULL OR is_active = true)
      );
$function$;

GRANT EXECUTE ON FUNCTION district_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION caller_full_scope() TO authenticated;

-- ----------------------------------------------------------------------------
-- 1. get_event_dashboard_stats — caller-scope authoritative
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_event_dashboard_stats(p_event_id UUID, p_district TEXT DEFAULT NULL, p_region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  total_delegates BIGINT := 0;
  total_checkins BIGINT := 0;
  total_arrivals BIGINT := 0;
  total_session_attendance BIGINT := 0;
  total_financials BIGINT := 0;
  rank_counts JSON := '{}'::JSON;
  district_counts JSON := '{}'::JSON;
  recent_activity JSON := '[]'::JSON;
  norm_district TEXT;
  norm_region TEXT;
  v_none BOOLEAN := false;
BEGIN
  IF caller_full_scope() THEN
    -- Unscoped caller: honour the client-supplied filter (normally null).
    norm_district := CASE WHEN p_district IS NOT NULL THEN district_key(p_district) ELSE NULL END;
    norm_region := CASE WHEN p_region IS NOT NULL THEN district_key(p_region) ELSE NULL END;
  ELSIF current_user_region() IS NOT NULL THEN
    norm_region := district_key(current_user_region());
    norm_district := NULL;
  ELSIF current_user_district() IS NOT NULL THEN
    norm_district := district_key(current_user_district());
    norm_region := NULL;
  ELSE
    -- Scoped-tier caller with no configured district/region -> fail closed.
    norm_district := '__NONE__';
    norm_region := NULL;
    v_none := true;
  END IF;

  IF v_none THEN
    RETURN json_build_object(
      'totalDelegates', 0, 'totalCheckIns', 0, 'totalArrivals', 0,
      'totalSessionAttendance', 0, 'totalFinancials', 0,
      'checkInsByRank', '{}'::JSON, 'checkInsByDistrict', '{}'::JSON, 'recentActivity', '[]'::JSON);
  END IF;

  IF norm_region IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id
      AND district_key(district) LIKE norm_region || '%';
  ELSIF norm_district IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id
      AND district_key(district) = norm_district;
  ELSE
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id;
  END IF;

  SELECT COUNT(DISTINCT c.delegate_id) INTO total_checkins
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND (
      norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR district_key(d.district) = norm_district
      )
    );

  SELECT COUNT(DISTINCT c.delegate_id) INTO total_arrivals
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND c.session_id IS NULL
    AND (
      norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR district_key(d.district) = norm_district
      )
    );

  SELECT COUNT(*) INTO total_session_attendance
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND c.session_id IS NOT NULL
    AND (
      norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR district_key(d.district) = norm_district
      )
    );

  -- Financial gate: admins / event admins / finance / executive_admin
  IF is_admin_user() OR is_event_admin_user()
     OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance','executive_admin') AND (is_active IS NULL OR is_active = true)) THEN
    SELECT COALESCE(SUM(amount), 0) INTO total_financials
    FROM financial_entries
    WHERE event_id = p_event_id;
  ELSE
    total_financials := 0;
  END IF;

  SELECT COALESCE(json_object_agg(rnk, cnt), '{}'::JSON) INTO rank_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER') AS rnk, COUNT(DISTINCT c.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE c.event_id = p_event_id
      AND (
        norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
        OR
        norm_region IS NULL AND (
          norm_district IS NULL OR district_key(d.district) = norm_district
        )
      )
    GROUP BY COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER')
  ) sub;

  SELECT COALESCE(json_object_agg(distname, cnt), '{}'::JSON) INTO district_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN') AS distname, COUNT(DISTINCT c.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE c.event_id = p_event_id
      AND (
        norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
        OR
        norm_region IS NULL AND (
          norm_district IS NULL OR district_key(d.district) = norm_district
        )
      )
    GROUP BY COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN')
  ) sub;

  SELECT COALESCE(json_agg(activity), '[]'::JSON) INTO recent_activity
  FROM (
    SELECT
      c.checkin_id, c.event_id, c.delegate_id, c.session_id,
      c.checked_in_at, c.checked_in_by,
      d.first_name || ' ' || d.last_name AS delegate_name,
      COALESCE(d.district, 'Unknown') AS district,
      COALESCE(d.rank, '-') AS rank,
      COALESCE(d.office, '-') AS office
    FROM (
      SELECT DISTINCT ON (delegate_id) *
      FROM checkins
      WHERE event_id = p_event_id
      ORDER BY delegate_id, checked_in_at DESC
    ) c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE (
      norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR district_key(d.district) = norm_district
      )
    )
    ORDER BY c.checked_in_at DESC
    LIMIT 10
  ) activity;

  RETURN json_build_object(
    'totalDelegates', total_delegates,
    'totalCheckIns', total_checkins,
    'totalArrivals', total_arrivals,
    'totalSessionAttendance', total_session_attendance,
    'totalFinancials', total_financials,
    'checkInsByRank', rank_counts,
    'checkInsByDistrict', district_counts,
    'recentActivity', recent_activity
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. get_report_aggregates — scope attended + session attendance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_report_aggregates(p_event_id UUID, p_session_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  attended_json JSON := '[]'::JSON;
  session_attendance_json JSON := '[]'::JSON;
  financials_json JSON := '[]'::JSON;
  pledges_json JSON := '[]'::JSON;
  v_scope_region TEXT := NULL;
  v_scope_district TEXT := NULL;
  v_none BOOLEAN := false;
BEGIN
  IF caller_full_scope() THEN
    NULL; -- full event
  ELSIF current_user_region() IS NOT NULL THEN
    v_scope_region := district_key(current_user_region());
  ELSIF current_user_district() IS NOT NULL THEN
    v_scope_district := district_key(current_user_district());
  ELSE
    v_scope_district := '__NONE__';
    v_none := true;
  END IF;

  IF NOT v_none THEN
    SELECT COALESCE(json_agg(d), '[]'::JSON) INTO attended_json
    FROM (
      SELECT d.delegate_id, d.title, d.first_name, d.last_name, d.chapter, d.district,
             d.email, d.phone, d.rank, d.office, d.delegate_type, d.room_number, c.checked_in_at
      FROM delegates d
      JOIN checkins c ON c.delegate_id = d.delegate_id AND c.event_id = d.event_id
      WHERE d.event_id = p_event_id
        AND ((p_session_id IS NULL AND c.session_id IS NULL)
             OR (p_session_id IS NOT NULL AND c.session_id = p_session_id))
        AND (v_scope_region IS NULL AND v_scope_district IS NULL
             OR (v_scope_region IS NOT NULL AND district_key(d.district) LIKE v_scope_region || '%')
             OR (v_scope_district IS NOT NULL AND district_key(d.district) = v_scope_district))
      ORDER BY d.chapter, d.last_name, d.first_name
    ) d;

    SELECT COALESCE(json_agg(sa), '[]'::JSON) INTO session_attendance_json
    FROM (
      SELECT c.session_id, COUNT(*) AS attendance
      FROM checkins c
      JOIN delegates d ON d.delegate_id = c.delegate_id AND d.event_id = p_event_id
      WHERE c.event_id = p_event_id AND c.session_id IS NOT NULL
        AND (v_scope_region IS NULL AND v_scope_district IS NULL
             OR (v_scope_region IS NOT NULL AND district_key(d.district) LIKE v_scope_region || '%')
             OR (v_scope_district IS NOT NULL AND district_key(d.district) = v_scope_district))
      GROUP BY c.session_id
    ) sa;
  END IF;

  -- Financial gate: admins / event admins / finance / executive_admin
  IF is_admin_user() OR is_event_admin_user()
     OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance','executive_admin') AND (is_active IS NULL OR is_active = true)) THEN
    SELECT COALESCE(json_agg(f), '[]'::JSON) INTO financials_json
    FROM (SELECT * FROM financial_entries WHERE event_id = p_event_id ORDER BY created_at) f;

    SELECT COALESCE(json_agg(p), '[]'::JSON) INTO pledges_json
    FROM (SELECT * FROM pledges WHERE event_id = p_event_id ORDER BY created_at) p;
  END IF;

  RETURN json_build_object(
    'attendedDelegates', attended_json,
    'sessionAttendance', session_attendance_json,
    'financials', financials_json,
    'pledges', pledges_json
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. get_ministry_export_data — scope per-delegate responses + attendance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_ministry_export_data(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    responses_json JSON := '[]'::JSON;
    summaries_json JSON := '[]'::JSON;
    vd_json JSON := '[]'::JSON;
    attendance_json JSON := '[]'::JSON;
    v_scope_region TEXT := NULL;
    v_scope_district TEXT := NULL;
BEGIN
  IF NOT caller_full_scope() THEN
    IF current_user_region() IS NOT NULL THEN
      v_scope_region := district_key(current_user_region());
    ELSIF current_user_district() IS NOT NULL THEN
      v_scope_district := district_key(current_user_district());
    ELSE
      v_scope_district := '__NONE__';
    END IF;
  END IF;

    IF v_scope_district IS DISTINCT FROM '__NONE__' THEN
      SELECT COALESCE(json_agg(r), '[]'::JSON) INTO responses_json
      FROM (
          SELECT sr.*,
              d.first_name, d.last_name, d.district, d.chapter, d.phone, d.rank, d.office,
              (d.first_name || ' ' || d.last_name) AS delegate_name,
              s.title AS session_title
          FROM session_responses sr
          JOIN delegates d ON sr.delegate_id = d.delegate_id
          JOIN sessions s ON sr.session_id = s.session_id
          WHERE sr.event_id = p_event_id
            AND (v_scope_region IS NULL AND v_scope_district IS NULL
                 OR (v_scope_region IS NOT NULL AND district_key(d.district) LIKE v_scope_region || '%')
                 OR (v_scope_district IS NOT NULL AND district_key(d.district) = v_scope_district))
          ORDER BY sr.recorded_at DESC
      ) r;
    END IF;

    SELECT COALESCE(json_agg(s), '[]'::JSON) INTO summaries_json
    FROM (
        SELECT srs.*, s.title AS session_title
        FROM session_response_summaries srs
        JOIN sessions s ON srs.session_id = s.session_id
        WHERE srs.event_id = p_event_id
        ORDER BY srs.entered_at DESC
    ) s;
    SELECT COALESCE(json_agg(v), '[]'::JSON) INTO vd_json
    FROM (
        SELECT svd.*, s.title AS session_title
        FROM session_voice_distribution svd
        JOIN sessions s ON svd.session_id = s.session_id
        WHERE svd.event_id = p_event_id
        ORDER BY svd.updated_at DESC
    ) v;
    SELECT COALESCE(json_agg(a), '[]'::JSON) INTO attendance_json
    FROM (
        SELECT
            s.session_id,
            s.title AS session_title,
            COUNT(DISTINCT c.delegate_id) AS attendance
        FROM sessions s
        LEFT JOIN checkins c ON c.session_id = s.session_id AND c.event_id = p_event_id
        LEFT JOIN delegates d ON d.delegate_id = c.delegate_id
        WHERE s.event_id = p_event_id
          AND (v_scope_region IS NULL AND v_scope_district IS NULL
               OR (v_scope_region IS NOT NULL AND district_key(d.district) LIKE v_scope_region || '%')
               OR (v_scope_district IS NOT NULL AND district_key(d.district) = v_scope_district))
        GROUP BY s.session_id, s.title, s.start_time
        ORDER BY s.start_time
    ) a;
    RETURN json_build_object(
        'responses', responses_json,
        'summaries', summaries_json,
        'voiceDistribution', vd_json,
        'attendance', attendance_json
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. session_responses.sr_select — role + district scoping (pass 3 parity)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "sr_select" ON session_responses;
DROP POLICY IF EXISTS "sr_select_scoped" ON session_responses;
CREATE POLICY "sr_select_scoped" ON session_responses FOR SELECT TO authenticated USING (
    is_admin_user()
    OR is_event_admin_user()
    OR is_national_role_user()
    OR EXISTS (
        SELECT 1 FROM delegates
        WHERE delegates.delegate_id = session_responses.delegate_id
          AND ( (current_user_district() IS NOT NULL AND delegates.district ILIKE current_user_district())
             OR (current_user_region() IS NOT NULL AND delegates.district ILIKE current_user_region() || '%') )
    )
);

-- ----------------------------------------------------------------------------
-- 5. Grants (idempotent; CREATE OR REPLACE preserves grants, explicit anyway)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_report_aggregates(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_report_aggregates(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_report_aggregates(UUID, UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_report_aggregates(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.get_ministry_export_data(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ministry_export_data(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ministry_export_data(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_ministry_export_data(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. VERIFICATION (read-only)
-- ----------------------------------------------------------------------------
-- SELECT proname, proargnames FROM pg_proc
-- WHERE proname IN ('get_event_dashboard_stats','get_report_aggregates','get_ministry_export_data');
-- SELECT tablename, policyname, cmd, qual FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'session_responses';