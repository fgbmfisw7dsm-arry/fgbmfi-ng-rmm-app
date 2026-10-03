-- ============================================================================
-- v1.68 — Unified delegate search (full-name + fast)
-- ----------------------------------------------------------------------------
-- Replaces the fragile client-side `.or(first_name.ilike, last_name.ilike,
-- phone.ilike)` search (which cannot match multi-word full names, cannot use
-- the multi-column GIN index, and truncates at limit(100) with no ordering)
-- with a single tokenized, indexed, server-paginated RPC.
--
-- Idempotent. Deploy BEFORE the frontend (the client falls back to the legacy
-- path if this function is missing).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Generated, trgm-indexed search column ----------------------------------
-- Built from base columns only: `name_display` is itself a GENERATED column and
-- PostgreSQL forbids a generated column referencing another generated column.
-- concat_ws() is STABLE, not IMMUTABLE, so it cannot be used here — use ||.
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS search_text TEXT
  GENERATED ALWAYS AS (
    lower(
      coalesce(title, '') || ' ' ||
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(phone, '') || ' ' ||
      coalesce(phone_normalized, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(external_id, '') || ' ' ||
      coalesce(chapter, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_delegates_search_trgm
  ON delegates USING gin (search_text gin_trgm_ops);

-- 2) Tokenized, event-scoped, RLS-respecting search RPC ---------------------
-- SECURITY INVOKER so the caller's `delegates_select_scoped` RLS applies
-- (district/region officers only see what they may verify).
CREATE OR REPLACE FUNCTION search_delegates_v2(
  p_event_id   uuid,
  p_query      text,
  p_session_id uuid    DEFAULT NULL,
  p_district   text    DEFAULT NULL,
  p_region     text    DEFAULT NULL,
  p_limit      integer DEFAULT 50,
  p_offset     integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $func$
DECLARE
  v_tokens text[];
  v_total  integer;
  v_rows   jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('delegates', '[]'::jsonb, 'total', 0, 'page', 1, 'pageSize', p_limit);
  END IF;

  v_tokens := array_remove(regexp_split_to_array(lower(btrim(coalesce(p_query, ''))), '\s+'), '');

  WITH base AS (
    SELECT d.*
    FROM delegates d
    WHERE d.event_id = p_event_id
      AND (p_district IS NULL OR d.district ILIKE p_district)
      AND (p_region   IS NULL OR d.district ILIKE p_region || '%')
      AND (
        coalesce(array_length(v_tokens, 1), 0) = 0
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(v_tokens) AS tok
          WHERE d.search_text NOT LIKE
            '%' || replace(replace(replace(tok, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        )
      )
  )
  SELECT count(*)::integer INTO v_total FROM base;

  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT b.*,
      EXISTS (
        SELECT 1 FROM checkins c
        WHERE c.event_id = p_event_id
          AND c.delegate_id = b.delegate_id
          AND (
            (p_session_id IS NULL AND c.session_id IS NULL)
            OR (p_session_id IS NOT NULL AND c.session_id = p_session_id)
          )
      ) AS "checkedIn"
    FROM base b
    ORDER BY b.last_name, b.first_name
    LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0)
  ) sub;

  RETURN jsonb_build_object(
    'delegates', v_rows,
    'total', v_total,
    'page', (GREATEST(p_offset, 0) / GREATEST(p_limit, 1)) + 1,
    'pageSize', GREATEST(p_limit, 1)
  );
END;
$func$;

REVOKE ALL ON FUNCTION search_delegates_v2(uuid, text, uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION search_delegates_v2(uuid, text, uuid, text, text, integer, integer) TO authenticated, service_role;

-- 3) Verification (read-only) ------------------------------------------------
-- EXPLAIN ANALYZE
-- SELECT * FROM delegates
-- WHERE event_id = '<event-uuid>'
--   AND search_text LIKE '%patrick%' AND search_text LIKE '%arah%';
-- Expect a Bitmap Index Scan on idx_delegates_search_trgm.
