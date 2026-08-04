-- Sprint 13: Fix delegate-arrival parity + regional scoping + data-repair diagnostic
-- Run in Supabase SQL Editor. Idempotent (safe to re-run).
-- ============================================================================
-- Part 1: Update get_paginated_delegates — add p_region parameter
-- ============================================================================
DROP FUNCTION IF EXISTS get_paginated_delegates(INTEGER, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_paginated_delegates(INTEGER, INTEGER, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS get_paginated_delegates(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION get_paginated_delegates(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_district TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_event_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  total_count BIGINT;
  results JSON;
  offset_val INTEGER;
  norm_district TEXT;
  norm_region TEXT;
BEGIN
  offset_val := (p_page - 1) * p_page_size;
  norm_district := CASE WHEN p_district IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g')) ELSE NULL END;
  norm_region := CASE WHEN p_region IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_region), '\s+', ' ', 'g')) ELSE NULL END;

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
    norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) LIKE norm_region || '%'
    OR
    norm_region IS NULL AND (
      norm_district IS NULL OR
      UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = norm_district
    )
  )
  AND (
    p_event_id IS NULL OR
    event_id = p_event_id
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
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = norm_district
      )
    )
    AND (
      p_event_id IS NULL OR
      event_id = p_event_id
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


-- ============================================================================
-- Part 2: Update get_event_dashboard_stats — add p_region + fix arrival denominator
--         Key fix: total_arrivals JOINs on d.event_id = p_event_id so delegates
--         and arrivals share the same event-scoped population.
-- ============================================================================
DROP FUNCTION IF EXISTS get_event_dashboard_stats(UUID, TEXT);
DROP FUNCTION IF EXISTS get_event_dashboard_stats(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_event_dashboard_stats(
  p_event_id UUID,
  p_district TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  total_delegates BIGINT;
  total_checkins BIGINT;
  total_arrivals BIGINT;
  total_session_attendance BIGINT;
  total_financials BIGINT;
  rank_counts JSON;
  district_counts JSON;
  recent_activity JSON;
  norm_district TEXT;
  norm_region TEXT;
BEGIN
  norm_district := CASE WHEN p_district IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g')) ELSE NULL END;
  norm_region := CASE WHEN p_region IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_region), '\s+', ' ', 'g')) ELSE NULL END;

  -- total_delegates: delegates owned by this event, respecting region/district scope
  IF norm_region IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id
      AND UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) LIKE norm_region || '%';
  ELSIF norm_district IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id
      AND UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = norm_district;
  ELSE
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id;
  END IF;

  -- total_checkins: distinct delegates in this event's checkins, anchored to this event's delegate population
  SELECT COUNT(DISTINCT c.delegate_id) INTO total_checkins
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND (
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
      )
    );

  -- total_arrivals: distinct delegates with arrival checkins (session_id IS NULL), same event anchor
  SELECT COUNT(DISTINCT c.delegate_id) INTO total_arrivals
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND c.session_id IS NULL
    AND (
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
      )
    );

  -- total_session_attendance: count of session checkins, same event anchor
  SELECT COUNT(*) INTO total_session_attendance
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND c.session_id IS NOT NULL
    AND (
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
      )
    );

  SELECT COALESCE(SUM(amount), 0) INTO total_financials
  FROM financial_entries
  WHERE event_id = p_event_id;

  SELECT COALESCE(json_object_agg(rnk, cnt), '{}'::JSON) INTO rank_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER') AS rnk, COUNT(DISTINCT c.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE c.event_id = p_event_id
      AND (
        norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
        OR
        norm_region IS NULL AND (
          norm_district IS NULL OR
          UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
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
        norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
        OR
        norm_region IS NULL AND (
          norm_district IS NULL OR
          UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
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
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- Part 3: Data-repair — backfill delegates.event_id for unambiguous rows
--         and generate a diagnostic report of ambiguous cases for DBA review.
-- ============================================================================

-- 3a. Diagnostic: count how many delegates have NULL or broken event_id
DO $$
DECLARE
  null_count INTEGER;
  cross_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM delegates WHERE event_id IS NULL;
  RAISE NOTICE '[DIAGNOSTIC] Delegates with NULL event_id: %', null_count;

  SELECT COUNT(*) INTO cross_count
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id
  WHERE c.event_id <> d.event_id
    AND d.event_id IS NOT NULL;
  RAISE NOTICE '[DIAGNOSTIC] Checkins referencing delegate from a different event: %', cross_count;
END $$;

-- 3b. Backfill event_id from checkins where the delegate has exactly one event
--     (unambiguous — only checked into one event)
UPDATE delegates d
SET event_id = (
  SELECT c.event_id
  FROM checkins c
  WHERE c.delegate_id = d.delegate_id
  ORDER BY c.checked_in_at DESC
  LIMIT 1
)
WHERE d.event_id IS NULL
  AND (
    SELECT COUNT(DISTINCT c.event_id)
    FROM checkins c
    WHERE c.delegate_id = d.delegate_id
  ) = 1
  AND EXISTS (
    SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id
  );

-- 3c. Backfill event_id from the most recent checkin for still-NULL delegates
--     (heuristic: last checkin's event is the most likely current event)
UPDATE delegates d
SET event_id = (
  SELECT c.event_id
  FROM checkins c
  WHERE c.delegate_id = d.delegate_id
  ORDER BY c.checked_in_at DESC
  LIMIT 1
)
WHERE d.event_id IS NULL
  AND EXISTS (
    SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id
  );

-- 3c2. Backfill delegates with the bogus zero-UUID placeholder (00000000-...-000000000001)
--      These are legacy delegates created before event_id was enforced — same logic as NULL.
UPDATE delegates d
SET event_id = (
  SELECT c.event_id
  FROM checkins c
  WHERE c.delegate_id = d.delegate_id
  ORDER BY c.checked_in_at DESC
  LIMIT 1
)
WHERE d.event_id = '00000000-0000-0000-0000-000000000001'
  AND EXISTS (
    SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id
  );

-- 3d. Diagnostic: remaining delegates still missing event_id (no checkins at all)
SELECT 'WARNING: delegates with NULL event_id and no checkins (cannot auto-resolve)' AS diagnostic,
       delegate_id, first_name, last_name, district, registration_source, created_at
FROM delegates
WHERE event_id IS NULL
ORDER BY created_at DESC
LIMIT 100;

-- 3e. Diagnostic: cross-event delegates (checked into an event different from their owner)
SELECT 'WARNING: checkins referencing a delegate from a different event (may need manual reassignment)' AS diagnostic,
       c.event_id AS checkin_event, d.event_id AS delegate_event,
       c.delegate_id, d.first_name, d.last_name, d.district, c.checked_in_at
FROM checkins c
JOIN delegates d ON c.delegate_id = d.delegate_id
WHERE c.event_id <> d.event_id
  AND d.event_id IS NOT NULL
ORDER BY c.checked_in_at DESC
LIMIT 100;

-- Post-repair final count
DO $$
DECLARE
  remaining_null INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_null FROM delegates WHERE event_id IS NULL;
  RAISE NOTICE '[FINAL] Delegates with NULL event_id remaining: %', remaining_null;
END $$;
