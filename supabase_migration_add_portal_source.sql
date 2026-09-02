-- ============================================================================
-- Portal vs Manual Registration Source (v1.44)
-- ----------------------------------------------------------------------------
-- WHY: delegates are registered through two channels — FGBMFI Portal exports
-- (CSV rows carry a real RegId, e.g. CON26...) and manual registration outside
-- the portal (CSV rows have no RegId). Both were collapsed to
-- registration_source='import' on bulk import, so the Master List cannot tell
-- them apart for filtering / CSV+PDF export.
--
-- FIX:
--   1) Add 'portal' to the delegates.registration_source CHECK constraint.
--      'portal'  = row imported from a portal export carrying a real RegId.
--      'import'  = row imported from a manual (non-portal) CSV (Manual filter).
--      'manual'  = manually registered via the New Delegate form.
--      'qr_scan' = registered at the door via QR scan.
--   2) Extend get_paginated_delegates with p_registration_source so the Master
--      List Source filter is applied server-side (correct COUNT + pagination
--      at 25K scale). 'manual' = NOT 'portal' (covers import/manual/qr_scan).
--
-- Idempotent: safe to re-run.
-- Deploy: Run in the Supabase SQL Editor (postgres role).
-- ============================================================================

-- 1) Relax the registration_source CHECK constraint (add 'portal' value).
ALTER TABLE delegates DROP CONSTRAINT IF EXISTS delegates_registration_source_check;
ALTER TABLE delegates ADD CONSTRAINT delegates_registration_source_check
  CHECK (registration_source IN ('import', 'manual', 'qr_scan', 'portal'));

-- 2) Rebuild get_paginated_delegates with the Source filter.
--    DROP prior signature overloads so the new signature is unambiguous.
DROP FUNCTION IF EXISTS get_paginated_delegates(INTEGER, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_paginated_delegates(INTEGER, INTEGER, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS get_paginated_delegates(INTEGER, INTEGER, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS get_paginated_delegates(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION get_paginated_delegates(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_district TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_registration_source TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
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
  )
  AND (
    p_region IS NULL OR
    UPPER(TRIM(district)) LIKE UPPER(regexp_replace(TRIM(p_region), '\s+', ' ', 'g')) || '%'
  )
  AND (
    p_event_id IS NULL OR
    event_id = p_event_id
  )
  AND (
    p_registration_source IS NULL
    OR p_registration_source NOT IN ('portal', 'manual')
    OR (p_registration_source = 'portal'  AND registration_source = 'portal')
    OR (p_registration_source = 'manual'  AND COALESCE(registration_source, 'import') <> 'portal')
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
    AND (
      p_region IS NULL OR
      UPPER(TRIM(district)) LIKE UPPER(regexp_replace(TRIM(p_region), '\s+', ' ', 'g')) || '%'
    )
    AND (
      p_event_id IS NULL OR
      event_id = p_event_id
    )
    AND (
      p_registration_source IS NULL
      OR p_registration_source NOT IN ('portal', 'manual')
      OR (p_registration_source = 'portal'  AND registration_source = 'portal')
      OR (p_registration_source = 'manual'  AND COALESCE(registration_source, 'import') <> 'portal')
    )
    ORDER BY chapter, last_name, first_name
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
$func$;

-- Sanity check: rows that currently carry a non-portal / portal source value.
SELECT registration_source, COUNT(*) AS rows
FROM delegates
GROUP BY registration_source
ORDER BY registration_source;