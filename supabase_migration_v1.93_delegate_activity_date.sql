-- ============================================================================
-- v1.93 — Delegate "activity date" (created or last detail change)
-- ============================================================================
-- Purpose: the Master List and Batch Badge Printing date range can now filter on
-- the LATEST activity (last update, or creation when never updated) instead of
-- only the creation date, so reprint cohorts can pick up corrected records.
--
-- Definition (confirmed with the product owner):
--   activity = the delegate record's DETAILS changed.
--   Printing a badge does NOT count. mark_badge_batch_printed /
--   mark_delegate_badge_printed write badge_printed + badge_printed_at, and the
--   generic touch trigger used to bump updated_at for those writes — which made
--   the reprint cohort grow while batches were being marked. Fixed in PART 3.
--
-- Additive + idempotent. Safe to re-run.
-- Deploy BEFORE the frontend (the badge module queries last_activity_at directly).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PART 1 — ensure updated_at exists and is populated (drift-proof)
-- ---------------------------------------------------------------------------
ALTER TABLE public.delegates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.delegates
   SET updated_at = COALESCE(updated_at, created_at, NOW())
 WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_delegates_event_updated
  ON public.delegates (event_id, updated_at);


-- ---------------------------------------------------------------------------
-- PART 2 — stored activity column + index
-- GREATEST is defensive: updated_at should already be >= created_at, but a
-- backfilled/imported row must never produce an activity date before creation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.delegates
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ
  GENERATED ALWAYS AS (GREATEST(created_at, COALESCE(updated_at, created_at))) STORED;

CREATE INDEX IF NOT EXISTS idx_delegates_event_activity
  ON public.delegates (event_id, last_activity_at);

ANALYZE public.delegates;


-- ---------------------------------------------------------------------------
-- PART 3 — trigger: only DETAIL changes move updated_at
--
-- The comparison is built from information_schema so it adapts to every real
-- column that exists on this database, and it deliberately skips:
--   * generated columns  — a BEFORE trigger sees them unset in NEW but computed
--     in OLD, so including them would make every UPDATE look like a change and
--     defeat the whole purpose. (This is the trap that breaks naive
--     `to_jsonb(NEW) - 'badge_printed'` implementations.)
--   * badge_printed / badge_printed_at — printing is not a detail change.
--   * delegate_id / created_at / updated_at — bookkeeping.
-- Any future non-generated column is picked up automatically.
-- ---------------------------------------------------------------------------
DO $rebuild$
DECLARE
  v_compare TEXT;
  v_sql TEXT;
BEGIN
  SELECT string_agg(
           format('NEW.%I IS DISTINCT FROM OLD.%I', c.column_name, c.column_name),
           E'\n      OR '
           ORDER BY c.ordinal_position
         )
    INTO v_compare
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'delegates'
     AND c.column_name NOT IN ('delegate_id', 'created_at', 'updated_at',
                               'badge_printed', 'badge_printed_at')
     AND COALESCE(c.is_generated, 'NEVER') <> 'ALWAYS';

  IF v_compare IS NULL THEN
    RAISE EXCEPTION 'v1.93 FAILED: could not build the delegate column comparison list';
  END IF;

  v_sql := format($tmpl$
CREATE OR REPLACE FUNCTION public.touch_delegates_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF %s THEN
    NEW.updated_at := NOW();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$fn$;
$tmpl$, v_compare);

  EXECUTE v_sql;
END;
$rebuild$;

DROP TRIGGER IF EXISTS trg_delegates_updated_at ON public.delegates;
CREATE TRIGGER trg_delegates_updated_at
  BEFORE UPDATE ON public.delegates
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_delegates_updated_at();


-- ---------------------------------------------------------------------------
-- PART 4 — get_paginated_delegates: basis-aware registration window
--
-- p_date_basis: 'created' (default, preserves v1.92 behaviour for any client
-- that does not send it) | 'activity' (created or last detail change).
-- ⚠️ The 10-arg signature is DROPPED first — CREATE OR REPLACE with a different
-- argument count creates an OVERLOAD (§74).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_paginated_delegates(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_district TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_registration_source TEXT DEFAULT NULL,
  p_reg_type TEXT DEFAULT NULL,
  p_created_from TIMESTAMPTZ DEFAULT NULL,
  p_created_to TIMESTAMPTZ DEFAULT NULL,
  p_date_basis TEXT DEFAULT 'created'
) RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $func$
DECLARE
  total_count BIGINT;
  results JSON;
  offset_val INTEGER;
  v_q TEXT;
  v_tokens TEXT[];
  v_basis TEXT := CASE WHEN lower(COALESCE(p_date_basis, 'created')) = 'activity' THEN 'activity' ELSE 'created' END;
BEGIN
  offset_val := (p_page - 1) * p_page_size;
  v_q := lower(btrim(coalesce(p_search, '')));
  v_tokens := array_remove(regexp_split_to_array(v_q, '\s+'), '');

  SELECT COUNT(*) INTO total_count FROM delegates
  WHERE (
    p_search IS NULL OR btrim(p_search) = '' OR
    NOT EXISTS (
      SELECT 1 FROM unnest(v_tokens) AS tok
      WHERE (' ' || coalesce(name_search, '') || ' ') NOT LIKE '% ' || search_escape(tok) || '%'
    ) OR
    lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) LIKE search_escape(v_q) || '%' OR
    lower(coalesce(last_name, '') || ' ' || coalesce(first_name, '')) LIKE search_escape(v_q) || '%' OR
    (length(v_q) >= 3 AND normalize_phone_sql(p_search) = phone_normalized) OR
    (position('@' in v_q) > 0 AND lower(coalesce(email, '')) = v_q) OR
    lower(coalesce(external_id, '')) = v_q OR
    lower(delegate_id::text) = v_q OR
    (length(v_q) >= 6 AND lower(coalesce(external_id, '')) LIKE '%' || search_escape(v_q) || '%') OR
    (v_q ~ '^[0-9]+$' AND length(v_q) >= 4 AND (coalesce(phone_normalized, '') LIKE '%' || search_escape(v_q) || '%' OR coalesce(phone, '') LIKE '%' || search_escape(v_q) || '%'))
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
  AND (
    p_created_from IS NULL
    OR (v_basis = 'created'  AND created_at >= p_created_from)
    OR (v_basis = 'activity' AND last_activity_at >= p_created_from)
  )
  AND (
    p_created_to IS NULL
    OR (v_basis = 'created'  AND created_at <= p_created_to)
    OR (v_basis = 'activity' AND last_activity_at <= p_created_to)
  );

  SELECT COALESCE(json_agg(delegate_rows), '[]'::JSON) INTO results
  FROM (
    SELECT * FROM delegates
    WHERE (
      p_search IS NULL OR btrim(p_search) = '' OR
      NOT EXISTS (
        SELECT 1 FROM unnest(v_tokens) AS tok
        WHERE (' ' || coalesce(name_search, '') || ' ') NOT LIKE '% ' || search_escape(tok) || '%'
      ) OR
      lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) LIKE search_escape(v_q) || '%' OR
      lower(coalesce(last_name, '') || ' ' || coalesce(first_name, '')) LIKE search_escape(v_q) || '%' OR
      (length(v_q) >= 3 AND normalize_phone_sql(p_search) = phone_normalized) OR
      (position('@' in v_q) > 0 AND lower(coalesce(email, '')) = v_q) OR
      lower(coalesce(external_id, '')) = v_q OR
      lower(delegate_id::text) = v_q OR
      (length(v_q) >= 6 AND lower(coalesce(external_id, '')) LIKE '%' || search_escape(v_q) || '%') OR
      (v_q ~ '^[0-9]+$' AND length(v_q) >= 4 AND (coalesce(phone_normalized, '') LIKE '%' || search_escape(v_q) || '%' OR coalesce(phone, '') LIKE '%' || search_escape(v_q) || '%'))
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
    AND (
      p_created_from IS NULL
      OR (v_basis = 'created'  AND created_at >= p_created_from)
      OR (v_basis = 'activity' AND last_activity_at >= p_created_from)
    )
    AND (
      p_created_to IS NULL
      OR (v_basis = 'created'  AND created_at <= p_created_to)
      OR (v_basis = 'activity' AND last_activity_at <= p_created_to)
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

REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- PART 5 — verification (read-only, raises on failure)
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_overloads INT;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates';

  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'v1.93 FAILED: expected exactly 1 get_paginated_delegates, found %', v_overloads;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delegates'
      AND column_name = 'last_activity_at' AND is_generated = 'ALWAYS'
  ) THEN
    RAISE EXCEPTION 'v1.93 FAILED: delegates.last_activity_at is missing or not a generated column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_delegates_event_activity'
  ) THEN
    RAISE EXCEPTION 'v1.93 FAILED: idx_delegates_event_activity was not created';
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE proname = 'touch_delegates_updated_at' LIMIT 1) LIKE '%badge_printed%' THEN
    RAISE EXCEPTION 'v1.93 FAILED: touch_delegates_updated_at still compares badge columns';
  END IF;

  RAISE NOTICE 'v1.93 OK: last_activity_at + index, detail-only updated_at trigger, and basis-aware date-range RPC are in place.';
END;
$verify$;

-- Read-only sanity checks (uncomment to inspect before/after a deploy):
-- SELECT count(*) FILTER (WHERE last_activity_at IS NULL) AS null_activity,
--        count(*) FILTER (WHERE last_activity_at < created_at) AS activity_before_created
--   FROM public.delegates;
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='delegates' AND is_generated='ALWAYS'
--  ORDER BY ordinal_position;
