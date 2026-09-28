-- ============================================================================
-- EMS Reg Type — Master List 'EMS' Source (v1.61)
--
-- WHY: the New Delegate Entry form (EMS) writes `registration_source='EMS'`
-- (v1.55 §53) but `reg_type` defaulted to 'manual', so Master List "Source"
-- (which filters on `reg_type`) swallowed EMS registrations into Manual and
-- had no EMS bucket. This makes EMS a first-class reg_type value, exactly as
-- portal/web were added (v1.44 §42).
--
--   1) Widen delegates_reg_type_check to ('manual','portal','web','ems').
--   2) Backfill existing rows (registration_source='EMS') -> reg_type='ems'
--      (idempotent: the service now stores 'ems' on INSERT; this repairs rows
--      created before this deployment).
--   3) Rebuild get_paginated_delegates so p_reg_type='ems' filters server-side
--      and 'manual' excludes 'ems' (correct COUNT/pagination at 25K).
--
-- Deploy BEFORE/with the frontend (frontend-first would still filter correctly
-- on the fallback path, but server-side counts would be stale until deploy).
-- ============================================================================

-- 1) Constraint --------------------------------------------------------------
ALTER TABLE delegates DROP CONSTRAINT IF EXISTS delegates_reg_type_check;
ALTER TABLE delegates ADD CONSTRAINT delegates_reg_type_check
  CHECK (reg_type IN ('manual', 'portal', 'web', 'ems'));

-- 2) Backfill ----------------------------------------------------------------
UPDATE delegates SET reg_type = 'ems' WHERE registration_source = 'EMS';

-- 3) get_paginated_delegates (8-arg: ... + p_reg_type, ems-aware) ------------
CREATE OR REPLACE FUNCTION get_paginated_delegates(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_district TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_registration_source TEXT DEFAULT NULL,
  p_reg_type TEXT DEFAULT NULL
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
  )
  AND (
    p_reg_type IS NULL
    OR NOT (p_reg_type IN ('manual', 'portal', 'web', 'ems'))
    OR (p_reg_type = 'portal' AND reg_type = 'portal')
    OR (p_reg_type = 'web'    AND reg_type = 'web')
    OR (p_reg_type = 'ems'    AND reg_type = 'ems')
    OR (p_reg_type = 'manual' AND COALESCE(reg_type, 'manual') NOT IN ('portal', 'web', 'ems'))
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
    AND (
      p_reg_type IS NULL
      OR NOT (p_reg_type IN ('manual', 'portal', 'web', 'ems'))
      OR (p_reg_type = 'portal' AND reg_type = 'portal')
      OR (p_reg_type = 'web'    AND reg_type = 'web')
      OR (p_reg_type = 'ems'    AND reg_type = 'ems')
      OR (p_reg_type = 'manual' AND COALESCE(reg_type, 'manual') NOT IN ('portal', 'web', 'ems'))
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