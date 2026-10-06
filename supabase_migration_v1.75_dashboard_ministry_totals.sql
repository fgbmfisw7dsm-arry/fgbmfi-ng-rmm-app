-- ============================================================
-- FGBMFI Nigeria EMS — v1.75: Dashboard Session Ministry Totals
-- Extends get_event_dashboard_stats with five event-wide figures:
--   totalFirstTimers (FT), totalMembershipIntentions (MI),
--   totalSalvations (SLV), totalHolyBaptisms (HGB),
--   totalVoiceDistributions (VD).
--
-- Counting basis: session_responses (individual per-delegate records) ONLY.
-- Manual session_response_summaries are deliberately NOT included (see
-- AGENTS.md §19 — individual scanned counts and manual summaries are
-- separate validation figures and are never additive).
--
-- Scoping: FT/MI/SLV/HGB honor the caller's district/region exactly like
-- attendance/arrivals. VD has NO delegate link (session_voice_distribution
-- carries only event_id/session_id/total_distributed), so it is inherently
-- event-wide and is returned unscoped for every caller by design.
--
-- Idempotent (CREATE OR REPLACE). Deploy BEFORE the frontend.
-- ============================================================

CREATE OR REPLACE FUNCTION get_event_dashboard_stats(p_event_id UUID, p_district TEXT DEFAULT NULL, p_region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  total_delegates BIGINT := 0;
  total_checkins BIGINT := 0;
  total_arrivals BIGINT := 0;
  total_session_attendance BIGINT := 0;
  total_financials BIGINT := 0;
  total_first_timers BIGINT := 0;
  total_membership_intentions BIGINT := 0;
  total_salvations BIGINT := 0;
  total_holy_baptisms BIGINT := 0;
  total_voice_distributions BIGINT := 0;
  rank_counts JSON := '{}'::JSON;
  district_counts JSON := '{}'::JSON;
  recent_activity JSON := '[]'::JSON;
  norm_district TEXT;
  norm_region TEXT;
  v_none BOOLEAN := false;
BEGIN
  IF caller_full_scope() THEN
    norm_district := CASE WHEN p_district IS NOT NULL THEN district_key(p_district) ELSE NULL END;
    norm_region := CASE WHEN p_region IS NOT NULL THEN district_key(p_region) ELSE NULL END;
  ELSIF current_user_region() IS NOT NULL THEN
    norm_region := district_key(current_user_region());
    norm_district := NULL;
  ELSIF current_user_district() IS NOT NULL THEN
    norm_district := district_key(current_user_district());
    norm_region := NULL;
  ELSE
    norm_district := '__NONE__';
    norm_region := NULL;
    v_none := true;
  END IF;

  IF v_none THEN
    RETURN json_build_object(
      'totalDelegates', 0, 'totalCheckIns', 0, 'totalArrivals', 0,
      'totalSessionAttendance', 0, 'totalFinancials', 0,
      'totalFirstTimers', 0, 'totalMembershipIntentions', 0,
      'totalSalvations', 0, 'totalHolyBaptisms', 0, 'totalVoiceDistributions', 0,
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
    AND (norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR norm_region IS NULL AND (norm_district IS NULL OR district_key(d.district) = norm_district));

  SELECT COUNT(DISTINCT c.delegate_id) INTO total_arrivals
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id AND c.session_id IS NULL
    AND (norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR norm_region IS NULL AND (norm_district IS NULL OR district_key(d.district) = norm_district));

  SELECT COUNT(*) INTO total_session_attendance
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id AND c.session_id IS NOT NULL
    AND (norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR norm_region IS NULL AND (norm_district IS NULL OR district_key(d.district) = norm_district));

  -- v1.75: individual session responses (FT/MI/SLV/HGB), caller-scoped.
  SELECT
    COUNT(*) FILTER (WHERE sr.response_type = 'FT'),
    COUNT(*) FILTER (WHERE sr.response_type = 'MI'),
    COUNT(*) FILTER (WHERE sr.response_type = 'SLV'),
    COUNT(*) FILTER (WHERE sr.response_type = 'HGB')
  INTO total_first_timers, total_membership_intentions, total_salvations, total_holy_baptisms
  FROM session_responses sr
  JOIN delegates d ON sr.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE sr.event_id = p_event_id
    AND (norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR norm_region IS NULL AND (norm_district IS NULL OR district_key(d.district) = norm_district));

  -- v1.75: voice distribution is event-wide (no delegate link to scope by).
  SELECT COALESCE(SUM(total_distributed), 0) INTO total_voice_distributions
  FROM session_voice_distribution
  WHERE event_id = p_event_id;

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
      AND (norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
        OR norm_region IS NULL AND (norm_district IS NULL OR district_key(d.district) = norm_district))
    GROUP BY COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER')
  ) sub;

  SELECT COALESCE(json_object_agg(distname, cnt), '{}'::JSON) INTO district_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN') AS distname, COUNT(DISTINCT c.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE c.event_id = p_event_id
      AND (norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
        OR norm_region IS NULL AND (norm_district IS NULL OR district_key(d.district) = norm_district))
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
    WHERE (norm_region IS NOT NULL AND district_key(d.district) LIKE norm_region || '%'
      OR norm_region IS NULL AND (norm_district IS NULL OR district_key(d.district) = norm_district))
    ORDER BY c.checked_in_at DESC
    LIMIT 10
  ) activity;

  RETURN json_build_object(
    'totalDelegates', total_delegates,
    'totalCheckIns', total_checkins,
    'totalArrivals', total_arrivals,
    'totalSessionAttendance', total_session_attendance,
    'totalFinancials', total_financials,
    'totalFirstTimers', total_first_timers,
    'totalMembershipIntentions', total_membership_intentions,
    'totalSalvations', total_salvations,
    'totalHolyBaptisms', total_holy_baptisms,
    'totalVoiceDistributions', total_voice_distributions,
    'checkInsByRank', rank_counts,
    'checkInsByDistrict', district_counts,
    'recentActivity', recent_activity
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_event_dashboard_stats(UUID, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verify after deploy (replace <event_id>):
--   SELECT (get_event_dashboard_stats('<event_id>'::uuid))->>'totalFirstTimers';
--   SELECT (get_event_dashboard_stats('<event_id>'::uuid))->>'totalVoiceDistributions';
