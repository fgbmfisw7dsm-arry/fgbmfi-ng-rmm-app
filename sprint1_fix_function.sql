-- Fix: Re-create get_event_dashboard_stats with corrected column aliases
-- The original function had a scoping bug (references d.rank/d.district in outer subquery where alias d is not visible)
-- Run this in Supabase SQL Editor to replace with the fixed version

CREATE OR REPLACE FUNCTION get_event_dashboard_stats(p_event_id UUID, p_district_filter TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_delegates INT;
  v_total_checkins INT;
  v_total_financials NUMERIC;
  v_rank_breakdown JSONB;
  v_district_breakdown JSONB;
  v_recent_activity JSONB;
BEGIN
  IF p_district_filter IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total_delegates FROM delegates WHERE UPPER(TRIM(district)) = UPPER(TRIM(p_district_filter));
  ELSE
    SELECT COUNT(*) INTO v_total_delegates FROM delegates;
  END IF;

  SELECT COUNT(*) INTO v_total_checkins FROM (
    SELECT DISTINCT ON (UPPER(TRIM(d.first_name)), UPPER(TRIM(d.last_name)), UPPER(TRIM(d.district)), UPPER(TRIM(d.rank)))
      c.delegate_id
    FROM checkins c JOIN delegates d ON d.delegate_id = c.delegate_id
    WHERE c.event_id = p_event_id AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
  ) deduped;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_financials FROM financial_entries WHERE event_id = p_event_id;

  SELECT JSONB_OBJECT_AGG(rank_key, rank_count) INTO v_rank_breakdown FROM (
    SELECT COALESCE(NULLIF(TRIM(deduped.rank_col), ''), 'OTHER') AS rank_key, COUNT(*) AS rank_count FROM (
      SELECT DISTINCT ON (UPPER(TRIM(d.first_name)), UPPER(TRIM(d.last_name)), UPPER(TRIM(d.district)), UPPER(TRIM(d.rank)))
        d.rank AS rank_col
      FROM checkins c JOIN delegates d ON d.delegate_id = c.delegate_id
      WHERE c.event_id = p_event_id AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
    ) deduped GROUP BY rank_key
  ) ranks;

  SELECT JSONB_OBJECT_AGG(dist_key, dist_count) INTO v_district_breakdown FROM (
    SELECT COALESCE(NULLIF(TRIM(deduped.dist_col), ''), 'UNKNOWN') AS dist_key, COUNT(*) AS dist_count FROM (
      SELECT DISTINCT ON (UPPER(TRIM(d.first_name)), UPPER(TRIM(d.last_name)), UPPER(TRIM(d.district)), UPPER(TRIM(d.rank)))
        d.district AS dist_col
      FROM checkins c JOIN delegates d ON d.delegate_id = c.delegate_id
      WHERE c.event_id = p_event_id AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
    ) deduped GROUP BY dist_key
  ) dists;

  SELECT JSONB_AGG(sub) INTO v_recent_activity FROM (
    SELECT
      c.checkin_id, c.event_id, c.delegate_id, c.session_id, c.checked_in_at, c.checked_in_by,
      (d.first_name || ' ' || d.last_name) AS delegate_name,
      COALESCE(d.district, 'Unknown') AS district,
      COALESCE(d.rank, '-') AS rank,
      COALESCE(d.office, '-') AS office
    FROM checkins c JOIN delegates d ON d.delegate_id = c.delegate_id
    WHERE c.event_id = p_event_id AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
    ORDER BY c.checked_in_at DESC LIMIT 20
  ) sub;

  RETURN JSONB_BUILD_OBJECT(
    'totalDelegates', v_total_delegates,
    'totalCheckIns', v_total_checkins,
    'totalFinancials', v_total_financials,
    'checkInsByRank', COALESCE(v_rank_breakdown, '{}'::JSONB),
    'checkInsByDistrict', COALESCE(v_district_breakdown, '{}'::JSONB),
    'recentActivity', COALESCE(v_recent_activity, '[]'::JSONB)
  );
END;
$$;
