-- ============================================================================
-- v1.74b — FIX: search_delegates_v2 CTE scoping ("relation base does not exist")
-- ----------------------------------------------------------------------------
-- ROOT CAUSE (confirmed from the browser console):
--   [searchDelegatesPaged] RPC error — using legacy fallback:
--       relation "base" does not exist
--
-- The v2 / v2b / v3 bodies all declared `WITH base AS (...)` and then used
-- `base` from TWO SEPARATE SQL statements:
--
--     WITH base AS (...) SELECT count(*) INTO v_total FROM base;   -- stmt 1
--     SELECT ... FROM ( ... FROM base b ... ) sub;                 -- stmt 2
--
-- In PostgreSQL a CTE is only visible within the SINGLE statement it is
-- declared on, so the second statement threw `relation "base" does not exist`.
-- The RPC therefore NEVER returned a row; `searchDelegatesPaged` caught the
-- error and silently ran the legacy broad `%contains%` query. v1.74 added
-- pagination which exposed that legacy result set as "hundreds of pages",
-- and prefix matching never applied because the prefix code lives in the RPC.
--
-- FIX: one single statement. `base` is a CTE of that statement, consumed by
-- both the count scalar-subquery and the paged aggregate. Same predicate and
-- same relevance ORDER BY as v1.74 (now expressed via row_number()).
--
-- Also: drop the stale 7-arg get_paginated_delegates overload (old substring
-- body) and reload the PostgREST schema cache.
--
-- Idempotent. Safe to run on top of supabase_migration_search_v3_prefix.sql.
-- ============================================================================

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
  v_q      text;
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

  v_q := lower(btrim(coalesce(p_query, '')));
  v_tokens := array_remove(regexp_split_to_array(v_q, '\s+'), '');

  -- SINGLE statement: `base` is scoped here and used by both the count and the
  -- paged aggregate below. Do NOT split these into two statements.
  WITH base AS (
    SELECT d.*
    FROM delegates d
    WHERE d.event_id = p_event_id
      AND (p_district IS NULL OR d.district ILIKE p_district)
      AND (p_region   IS NULL OR d.district ILIKE p_region || '%')
      AND (
        coalesce(array_length(v_tokens, 1), 0) = 0
        OR (
          -- (A) name word-prefix, AND across tokens
          NOT EXISTS (
            SELECT 1
            FROM unnest(v_tokens) AS tok
            WHERE (' ' || coalesce(d.name_search, '') || ' ') NOT LIKE
              '% ' || search_escape(tok) || '%'
          )
          -- (B) combined full-name phrase prefix, either order
          OR lower(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, ''))
               LIKE search_escape(v_q) || '%'
          OR lower(coalesce(d.last_name, '') || ' ' || coalesce(d.first_name, ''))
               LIKE search_escape(v_q) || '%'
          -- (C) selective identifiers on the WHOLE query
          OR (length(v_q) >= 3 AND normalize_phone_sql(p_query) = d.phone_normalized)
          OR (position('@' in v_q) > 0 AND lower(coalesce(d.email, '')) = v_q)
          OR lower(coalesce(d.external_id, '')) = v_q
          OR lower(d.delegate_id::text) = v_q
          OR (length(v_q) >= 6 AND lower(coalesce(d.external_id, '')) LIKE '%' || search_escape(v_q) || '%')
          -- partial phone search stays available but ONLY for digit-only queries
          OR (v_q ~ '^[0-9]+$' AND length(v_q) >= 4
              AND (coalesce(d.phone_normalized, '') LIKE '%' || search_escape(v_q) || '%'
                   OR coalesce(d.phone, '') LIKE '%' || search_escape(v_q) || '%'))
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
        (lower(coalesce(b.external_id, '')) = v_q
          OR lower(b.delegate_id::text) = v_q
          OR (length(v_q) >= 3 AND normalize_phone_sql(p_query) = b.phone_normalized)
          OR (position('@' in v_q) > 0 AND lower(coalesce(b.email, '')) = v_q)) DESC,
        (lower(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')) = v_q
          OR lower(coalesce(b.last_name, '') || ' ' || coalesce(b.first_name, '')) = v_q) DESC,
        (lower(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')) LIKE search_escape(v_q) || '%'
          OR lower(coalesce(b.last_name, '') || ' ' || coalesce(b.first_name, '')) LIKE search_escape(v_q) || '%') DESC,
        (lower(coalesce(b.first_name, '')) = v_q OR lower(coalesce(b.last_name, '')) = v_q) DESC,
        (lower(coalesce(b.first_name, '')) LIKE search_escape(v_q) || '%'
          OR lower(coalesce(b.last_name, '')) LIKE search_escape(v_q) || '%') DESC,
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

-- Drop the stale 7-arg get_paginated_delegates overload (old substring body).
-- It also created an ambiguity for 5-arg callers (e.g. getAllDelegates).
DROP FUNCTION IF EXISTS get_paginated_delegates(integer, integer, text, text, text, uuid, text);

-- Make PostgREST pick up the new function body / removed overload immediately.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION (run these after the migration; the direct call MUST return a
-- count instead of erroring with `relation "base" does not exist`).
-- ----------------------------------------------------------------------------
-- SELECT (search_delegates_v2('<event-uuid>','Ayode',NULL,NULL,NULL,100,0))->>'total' AS total,
--        (search_delegates_v2('<event-uuid>','Ayode',NULL,NULL,NULL,100,0))->'delegates'->0->>'last_name' AS first_hit;
-- SELECT prosrc LIKE '%row_number() OVER%' AS base_fixed
--   FROM pg_proc WHERE proname='search_delegates_v2';
-- SELECT count(*) AS overloads FROM pg_proc WHERE proname='get_paginated_delegates';  -- expect 1
-- ============================================================================
