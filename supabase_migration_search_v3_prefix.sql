-- ============================================================================
-- v1.74 — Name word-prefix search + selective identifiers + bounded paging
-- ----------------------------------------------------------------------------
-- WHY: search_delegates_v2 matched each token as a SUBSTRING ANYWHERE in one
-- concatenated search_text (name + phone + email + external_id + chapter) and
-- the UI capped at 200 rows with no paging. A common first/surname produced
-- hundreds of matches (incl. incidental email/chapter hits), so a specific
-- delegate fell outside the returned 200 — findable by phone (selective) but
-- not by name. This migration:
--
--   1) Adds a name-only generated column `name_search` (word-separated,
--      lowercased) + a GIN trigram index.
--   2) Rebuilds `search_delegates_v2` (Check-In, Session Ministry, Individual
--      + Batch Badge, Financials) to match each typed token as a WORD PREFIX of
--      a name part (AND across tokens), plus a combined full-name phrase prefix
--      in both orders, plus SELECTIVE exact/whole-query identifier matches
--      (phone / email / external_id / delegate_id). Returns `total` for paging.
--   3) Rebuilds `get_paginated_delegates` (Master List) with the SAME predicate,
--      keeping the exact 8-arg signature and all district/region/source/reg_type
--      filters and counts.
--
-- Idempotent. Deploy BEFORE the frontend (the client falls back to the legacy
-- path when the function is missing).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 0) LIKE-escaping helper -----------------------------------------------------
CREATE OR REPLACE FUNCTION search_escape(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- 1) Name-only generated column (separators -> spaces, so each name part is a
--    "word"; e.g. "Uto-Dieu" -> "uto dieu", "O'Brien" -> "o brien") ----------
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS name_search TEXT
  GENERATED ALWAYS AS (
    lower(
      regexp_replace(
        coalesce(first_name, '') || ' ' || coalesce(last_name, ''),
        '[^a-zA-Z0-9]+', ' ', 'g'
      )
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_delegates_name_search_trgm
  ON delegates USING gin (name_search gin_trgm_ops);

-- 2) Lookup search RPC (tokenized, name-prefix, selective identifiers) --------
-- SECURITY INVOKER so the caller's `delegates_select_scoped` RLS applies.
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
    ORDER BY
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

-- 3) Master List paginated search — same predicate, 8-arg signature preserved --
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
SET search_path = public, extensions
AS $func$
DECLARE
  total_count BIGINT;
  results JSON;
  offset_val INTEGER;
  v_q TEXT;
  v_tokens TEXT[];
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

-- 4) Verification (read-only) -------------------------------------------------
-- SELECT is_generated FROM information_schema.columns
--   WHERE table_name='delegates' AND column_name='name_search';   -- ALWAYS
-- SELECT count(*) FROM search_delegates_v2('<event-uuid>', 'Ayode', NULL, NULL, NULL, 200, 0);
--   -- returns only first/last names with a word starting 'Ayode'
-- SELECT count(*) FROM get_paginated_delegates(1, 25, 'Ayo Ola', NULL, NULL, '<event-uuid>', NULL, NULL);
