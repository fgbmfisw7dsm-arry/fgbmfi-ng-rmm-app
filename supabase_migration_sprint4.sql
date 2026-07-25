-- Sprint 4: Dashboard RPC + Pagination support
-- Run this in Supabase SQL Editor

-- 4.1 Dashboard Stats RPC (replaces client-side getStats O(n) computation)
CREATE OR REPLACE FUNCTION get_event_dashboard_stats(
  p_event_id UUID,
  p_district TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  total_delegates BIGINT;
  total_checkins BIGINT;
  total_financials BIGINT;
  rank_counts JSON;
  district_counts JSON;
  recent_activity JSON;
  norm_district TEXT;
BEGIN
  norm_district := CASE WHEN p_district IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g')) ELSE NULL END;

  IF norm_district IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = norm_district;
  ELSE
    SELECT COUNT(*) INTO total_delegates FROM delegates;
  END IF;

  SELECT COUNT(DISTINCT d.delegate_id) INTO total_checkins
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id
  WHERE c.event_id = p_event_id
    AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district);

  SELECT COALESCE(SUM(amount), 0) INTO total_financials
  FROM financial_entries
  WHERE event_id = p_event_id;

  SELECT COALESCE(json_object_agg(rnk, cnt), '{}'::JSON) INTO rank_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER') AS rnk, COUNT(DISTINCT d.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
    GROUP BY COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER')
  ) sub;

  SELECT COALESCE(json_object_agg(distname, cnt), '{}'::JSON) INTO district_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN') AS distname, COUNT(DISTINCT d.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
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
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
    ORDER BY c.checked_in_at DESC
    LIMIT 10
  ) activity;

  RETURN json_build_object(
    'totalDelegates', total_delegates,
    'totalCheckIns', total_checkins,
    'totalFinancials', total_financials,
    'checkInsByRank', rank_counts,
    'checkInsByDistrict', district_counts,
    'recentActivity', recent_activity
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4.2 Paginated delegates query (for MasterListModule)
CREATE OR REPLACE FUNCTION get_paginated_delegates(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_district TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  total_count BIGINT;
  results JSON;
  offset_val INTEGER;
BEGIN
  offset_val := (p_page - 1) * p_page_size;

  SELECT COUNT(*) INTO total_count FROM delegates
  WHERE (
    p_search IS NULL OR
    first_name ILIKE '%' || p_search || '%' OR
    last_name ILIKE '%' || p_search || '%' OR
    phone ILIKE '%' || p_search || '%' OR
    email ILIKE '%' || p_search || '%' OR
    chapter ILIKE '%' || p_search || '%'
  )
  AND (
    p_district IS NULL OR
    UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g'))
  );

  SELECT COALESCE(json_agg(delegate_rows), '[]'::JSON) INTO results
  FROM (
    SELECT * FROM delegates
    WHERE (
      p_search IS NULL OR
      first_name ILIKE '%' || p_search || '%' OR
      last_name ILIKE '%' || p_search || '%' OR
      phone ILIKE '%' || p_search || '%' OR
      email ILIKE '%' || p_search || '%' OR
      chapter ILIKE '%' || p_search || '%'
    )
    AND (
      p_district IS NULL OR
      UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g'))
    )
    ORDER BY first_name, last_name
    LIMIT p_page_size
    OFFSET offset_val
  ) delegate_rows;

  RETURN json_build_object(
    'data', results,
    'total', total_count,
    'page', p_page,
    'pageSize', p_page_size,
    'totalPages', CEIL(total_count::FLOAT / p_page_size)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4.5 Export data RPC (replaces getAllDataForExport)
CREATE OR REPLACE FUNCTION get_event_export_data(
  p_event_id UUID
) RETURNS JSON AS $$
DECLARE
  delegates_json JSON;
  checkins_json JSON;
  financials_json JSON;
  pledges_json JSON;
BEGIN
  SELECT COALESCE(json_agg(d), '[]'::JSON) INTO delegates_json
  FROM (
    SELECT delegate_id, title, first_name, last_name, district, chapter, phone, email, rank, office, room_number, created_at
    FROM delegates
    ORDER BY first_name, last_name
  ) d;

  SELECT COALESCE(json_agg(c), '[]'::JSON) INTO checkins_json
  FROM (
    SELECT c.*, d.first_name || ' ' || d.last_name AS delegate_name, d.district, d.rank, d.office
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
    ORDER BY c.checked_in_at
  ) c;

  SELECT COALESCE(json_agg(f), '[]'::JSON) INTO financials_json
  FROM (
    SELECT * FROM financial_entries
    WHERE event_id = p_event_id
    ORDER BY created_at
  ) f;

  SELECT COALESCE(json_agg(p), '[]'::JSON) INTO pledges_json
  FROM (
    SELECT * FROM pledges
    WHERE event_id = p_event_id
    ORDER BY created_at
  ) p;

  RETURN json_build_object(
    'delegates', delegates_json,
    'checkins', checkins_json,
    'financials', financials_json,
    'pledges', pledges_json
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
