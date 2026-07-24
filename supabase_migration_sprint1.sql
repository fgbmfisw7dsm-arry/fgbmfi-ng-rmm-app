-- ============================================================
-- FGBMFI Nigeria EMS — Sprint 1: Database Performance Migration
-- Run this in Supabase SQL Editor (Project → SQL Editor)
-- ============================================================

-- 1. Enable pg_trgm extension for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 2. Critical Indexes (Required for 25K delegate scale)
-- ============================================================

-- GIN trigram indexes for fuzzy name search (replace any existing btree on name)
DROP INDEX IF EXISTS idx_delegates_name_gin;
CREATE INDEX idx_delegates_name_gin 
  ON delegates USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);

-- B-tree on phone for direct lookup
DROP INDEX IF EXISTS idx_delegates_phone;
CREATE INDEX idx_delegates_phone ON delegates(phone);

-- Composite indexes for check-in queries (most frequent operation)
DROP INDEX IF EXISTS idx_checkins_event_delegate;
CREATE INDEX idx_checkins_event_delegate ON checkins(event_id, delegate_id);

DROP INDEX IF EXISTS idx_checkins_event_session;
CREATE INDEX idx_checkins_event_session ON checkins(event_id, session_id);

-- Financial queries by event
DROP INDEX IF EXISTS idx_financials_event;
CREATE INDEX idx_financials_event ON financial_entries(event_id);

-- Pledge queries by event
DROP INDEX IF EXISTS idx_pledges_event;
CREATE INDEX idx_pledges_event ON pledges(event_id);

-- ============================================================
-- 3. Aggregate RPCs (Replace client-side getAllDataForExport)
-- ============================================================

-- Dashboard stats: returns counts and aggregates for a single event
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
  -- Total delegates (optionally filtered by district)
  IF p_district_filter IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total_delegates
    FROM delegates
    WHERE UPPER(TRIM(district)) = UPPER(TRIM(p_district_filter));
  ELSE
    SELECT COUNT(*) INTO v_total_delegates FROM delegates;
  END IF;

  -- Total unique check-ins (by delegate identity dedup)
  SELECT COUNT(*) INTO v_total_checkins
  FROM (
    SELECT DISTINCT ON (UPPER(TRIM(d.first_name)), UPPER(TRIM(d.last_name)), UPPER(TRIM(d.district)), UPPER(TRIM(d.rank)))
      c.delegate_id
    FROM checkins c
    JOIN delegates d ON d.delegate_id = c.delegate_id
    WHERE c.event_id = p_event_id
      AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
  ) deduped;

  -- Total financials
  SELECT COALESCE(SUM(amount), 0) INTO v_total_financials
  FROM financial_entries
  WHERE event_id = p_event_id;

  -- Rank breakdown
  SELECT JSONB_OBJECT_AGG(rank_key, rank_count) INTO v_rank_breakdown
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER') AS rank_key, COUNT(*) AS rank_count
    FROM (
      SELECT DISTINCT ON (UPPER(TRIM(d.first_name)), UPPER(TRIM(d.last_name)), UPPER(TRIM(d.district)), UPPER(TRIM(d.rank)))
        d.rank
      FROM checkins c
      JOIN delegates d ON d.delegate_id = c.delegate_id
      WHERE c.event_id = p_event_id
        AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
    ) deduped
    GROUP BY rank_key
  ) ranks;

  -- District breakdown
  SELECT JSONB_OBJECT_AGG(dist_key, dist_count) INTO v_district_breakdown
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN') AS dist_key, COUNT(*) AS dist_count
    FROM (
      SELECT DISTINCT ON (UPPER(TRIM(d.first_name)), UPPER(TRIM(d.last_name)), UPPER(TRIM(d.district)), UPPER(TRIM(d.rank)))
        d.district
      FROM checkins c
      JOIN delegates d ON d.delegate_id = c.delegate_id
      WHERE c.event_id = p_event_id
        AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
    ) deduped
    GROUP BY dist_key
  ) dists;

  -- Recent activity (last 20 check-ins)
  SELECT JSONB_AGG(sub) INTO v_recent_activity
  FROM (
    SELECT
      c.checkin_id,
      c.event_id,
      c.delegate_id,
      c.session_id,
      c.checked_in_at,
      c.checked_in_by,
      (d.first_name || ' ' || d.last_name) AS delegate_name,
      COALESCE(d.district, 'Unknown') AS district,
      COALESCE(d.rank, '-') AS rank,
      COALESCE(d.office, '-') AS office
    FROM checkins c
    JOIN delegates d ON d.delegate_id = c.delegate_id
    WHERE c.event_id = p_event_id
      AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)))
    ORDER BY c.checked_in_at DESC
    LIMIT 20
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

-- Search delegates with pagination: ILIKE on name/phone/email
CREATE OR REPLACE FUNCTION search_delegates(
  p_query TEXT,
  p_event_id UUID,
  p_district_filter TEXT DEFAULT NULL,
  p_session_id UUID DEFAULT NULL,
  p_page_size INT DEFAULT 50,
  p_page_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_results JSONB;
  v_total INT;
BEGIN
  -- Get total count
  SELECT COUNT(*) INTO v_total
  FROM delegates d
  WHERE (
    d.first_name ILIKE '%' || p_query || '%'
    OR d.last_name ILIKE '%' || p_query || '%'
    OR d.phone ILIKE '%' || p_query || '%'
  )
  AND (p_district_filter IS NULL OR UPPER(TRIM(d.district)) = UPPER(TRIM(p_district_filter)));

  -- Get paginated results with check-in status
  SELECT JSONB_AGG(sub) INTO v_results
  FROM (
    SELECT
      d.*,
      CASE WHEN c.delegate_id IS NOT NULL THEN true ELSE false END AS "checkedIn",
      CASE 
        WHEN c2.delegate_id IS NOT NULL THEN true 
        ELSE false 
      END AS "sessionCheckedIn"
    FROM delegates d
    LEFT JOIN (
      SELECT delegate_id FROM checkins 
      WHERE event_id = p_event_id AND session_id IS NULL
    ) c ON c.delegate_id = d.delegate_id
    LEFT JOIN (
      SELECT delegate_id FROM checkins 
      WHERE event_id = p_event_id AND session_id = p_session_id
    ) c2 ON c2.delegate_id = d.delegate_id
    WHERE (
      d.first_name ILIKE '%' || p_query || '%'
      OR d.last_name ILIKE '%' || p_query || '%'
      OR d.phone ILIKE '%' || p_query || '%'
    )
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
$$;

-- Bulk import delegates with deduplication and batch tracking
CREATE OR REPLACE FUNCTION import_delegates_batch(p_delegates JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
  v_skipped INT := 0;
  v_item JSONB;
  v_key TEXT;
BEGIN
  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    v_key := UPPER(
      TRIM(v_item->>'first_name') || '|' || 
      TRIM(v_item->>'last_name') || '|' || 
      COALESCE(TRIM(v_item->>'phone'), '')
    );
    
    -- Skip if duplicate exists (same name + phone)
    IF EXISTS (
      SELECT 1 FROM delegates 
      WHERE UPPER(TRIM(first_name)) = UPPER(TRIM(v_item->>'first_name'))
        AND UPPER(TRIM(last_name)) = UPPER(TRIM(v_item->>'last_name'))
        AND COALESCE(phone, '') = COALESCE(TRIM(v_item->>'phone'), '')
    ) THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO delegates (
        title, first_name, last_name, district, chapter,
        phone, email, rank, office
      ) VALUES (
        COALESCE(v_item->>'title', 'Mr'),
        TRIM(v_item->>'first_name'),
        TRIM(v_item->>'last_name'),
        TRIM(v_item->>'district'),
        TRIM(v_item->>'chapter'),
        TRIM(v_item->>'phone'),
        LOWER(TRIM(v_item->>'email')),
        COALESCE(v_item->>'rank', 'CP'),
        COALESCE(v_item->>'office', 'OTHER')
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'total', v_inserted + v_skipped
  );
END;
$$;

-- ============================================================
-- 4. Verify indexes were created
-- ============================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('delegates', 'checkins', 'financial_entries', 'pledges')
ORDER BY tablename, indexname;
