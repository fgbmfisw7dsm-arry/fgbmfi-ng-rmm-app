-- ============================================================================
-- v1.68-fix — search_text auto-repair + NULL-safe search + name ranking
-- ----------------------------------------------------------------------------
-- ⛔ SUPERSEDED by supabase_migration_search_v3b_fix_base_cte.sql (v1.74b).
--    Do NOT run this file standalone to "fix search" — run v3b instead. This
--    file is kept as history; its body was patched to the single-statement
--    form so a replay can no longer break the RPC (`relation "base"`).
-- ----------------------------------------------------------------------------
-- Fixes the "Print Individual Badge lookup shows other delegates, not the one
-- searched" regression introduced when the token filter failed OPEN on a NULL
-- search_text (every row matched), and adds name-relevance ordering so an exact
-- surname/first-name hit (e.g. "Arah") ranks above incidental substring matches
-- in other fields (e.g. a "sarah@…" email).
--
-- Idempotent. Run AFTER supabase_migration_search_v2.sql.
-- ============================================================================

-- 1) Ensure search_text exists AND is a populated GENERATED column -------------
-- If a plain (non-generated) search_text column pre-existed, ADD COLUMN IF NOT
-- EXISTS skipped the generation and every value stayed NULL. Rebuild it.
DO $do$
DECLARE
  v_gen text;
BEGIN
  SELECT is_generated INTO v_gen
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'delegates' AND column_name = 'search_text';

  IF v_gen IS NULL THEN
    ALTER TABLE delegates ADD COLUMN search_text TEXT
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
  ELSIF v_gen <> 'ALWAYS' THEN
    -- Derived data only — safe to drop and rebuild as generated.
    ALTER TABLE delegates DROP COLUMN search_text;
    ALTER TABLE delegates ADD COLUMN search_text TEXT
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
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_delegates_search_trgm
  ON delegates USING gin (search_text gin_trgm_ops);

-- 2) NULL-safe, name-ranked search -------------------------------------------
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
  v_q      text;
  v_total  integer;
  v_rows   jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('delegates', '[]'::jsonb, 'total', 0, 'page', 1, 'pageSize', p_limit);
  END IF;

  v_q := lower(btrim(coalesce(p_query, '')));
  v_tokens := array_remove(regexp_split_to_array(v_q, '\s+'), '');

  -- SINGLE statement: the CTE `base` is scoped to this statement and used by
  -- both the count and the paged aggregate. (Earlier versions referenced `base`
  -- from a SECOND statement -> `relation "base" does not exist`.)
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
          WHERE coalesce(d.search_text, '') NOT LIKE
            '%' || replace(replace(replace(tok, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        )
      )
  )
  SELECT
    (SELECT count(*)::integer FROM base) AS total,
    COALESCE(jsonb_agg(page ORDER BY page.ord), '[]'::jsonb) AS rows
  INTO v_total, v_rows
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
      ) AS "checkedIn",
      row_number() OVER (ORDER BY
        (lower(coalesce(b.first_name, '')) = v_q
          OR lower(coalesce(b.last_name, '')) = v_q
          OR lower(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')) = v_q
          OR lower(coalesce(b.last_name, '') || ' ' || coalesce(b.first_name, '')) = v_q) DESC,
        (lower(coalesce(b.first_name, '')) LIKE v_q || '%'
          OR lower(coalesce(b.last_name, '')) LIKE v_q || '%') DESC,
        (position(v_q in lower(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, ''))) > 0) DESC,
        b.last_name, b.first_name
      ) AS ord
    FROM base b
  ) page
  WHERE page.ord >  GREATEST(p_offset, 0)
    AND page.ord <= GREATEST(p_offset, 0) + GREATEST(p_limit, 1);

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

-- 3) Verification -------------------------------------------------------------
-- SELECT is_generated FROM information_schema.columns
--   WHERE table_name='delegates' AND column_name='search_text';       -- ALWAYS
-- SELECT count(*) FILTER (WHERE search_text IS NULL) FROM delegates;   -- 0
-- SELECT count(*) FROM search_delegates_v2('<event-uuid>', 'Arah', NULL, NULL, NULL, 200, 0);
