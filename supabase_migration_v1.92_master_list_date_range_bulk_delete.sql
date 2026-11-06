-- ============================================================================
-- v1.92 — Master List: registration date-range filter + transactional bulk delete
-- ============================================================================
-- Additive and idempotent. Safe to re-run.
--
-- PART 1 — idx_delegates_event_created_at
--   `delegates.created_at` had no index, so "registered between x and y" would
--   sequentially scan the event's rows on every page. (event_id, created_at) is
--   the exact shape of the new predicate + the existing event scope.
--
-- PART 2 — get_paginated_delegates gains p_created_from / p_created_to
--   ⚠️ CREATE OR REPLACE with a different argument count creates an OVERLOAD,
--   it does not replace. The 8-arg signature is DROPPED first (see §74: a stale
--   overload previously made every call ambiguous and broke search for months).
--   The body is otherwise byte-identical to the deployed v1.89b version, so
--   search / district / region / source / reg_type semantics cannot drift.
--   Both new params default to NULL -> every existing caller keeps working.
--
-- PART 3 — delete_delegates_bulk(p_event_id, p_ids)
--   One transaction: admin gate -> event-active guard -> the per-event
--   `delegate_deletion_enabled` switch -> dependent cascades -> delegates ->
--   audit. SECURITY INVOKER, so RLS governs exactly as the client path did.
--   Replaces the 4-requests-per-500-rows client loop (partial deletes) and
--   sidesteps the ~32 KB PostgREST URL ceiling that bit 1000-id batches.
--
-- Deploy order: this file FIRST, then the frontend. The frontend degrades to the
-- classic paths when either function is missing (USE_BULK_DELETE_RPC /
-- RPC-error fallback), so a frontend-first deploy is also non-breaking.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PART 1 — index for the registration date-range filter
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_delegates_event_created_at
  ON public.delegates (event_id, created_at);

ANALYZE public.delegates;


-- ---------------------------------------------------------------------------
-- PART 2 — get_paginated_delegates (10-arg, additively defaulted dates)
-- ---------------------------------------------------------------------------

-- Must DROP (not replace) — a different argument list would create an overload.
DROP FUNCTION IF EXISTS public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text);
-- Legacy shapes, defensive: drop any older arity that may still linger.
DROP FUNCTION IF EXISTS public.get_paginated_delegates(integer, integer, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.get_paginated_delegates(integer, integer, text, text, text);
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
  p_created_to TIMESTAMPTZ DEFAULT NULL
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
  -- v1.92: inclusive registration window (client sends local-day bounds as UTC)
  AND (p_created_from IS NULL OR created_at >= p_created_from)
  AND (p_created_to   IS NULL OR created_at <= p_created_to);

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
    -- v1.92: inclusive registration window
    AND (p_created_from IS NULL OR created_at >= p_created_from)
    AND (p_created_to   IS NULL OR created_at <= p_created_to)
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

REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz) TO service_role;


-- ---------------------------------------------------------------------------
-- PART 3 — transactional bulk delete (Master List checkboxes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_delegates_bulk(
  p_event_id UUID,
  p_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_active BOOLEAN;
  v_cfg JSONB;
  v_deleted INT := 0;
  v_sample TEXT;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  IF p_event_id IS NULL OR p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('deleted', 0, 'failedIds', '[]'::jsonb);
  END IF;

  IF array_length(p_ids, 1) > 25000 THEN
    RAISE EXCEPTION 'BULK_LIMIT: at most 25000 delegates per bulk delete';
  END IF;

  SELECT is_active, event_config INTO v_active, v_cfg
  FROM events WHERE event_id = p_event_id;

  IF v_active IS NULL THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND: no event with that id';
  END IF;

  IF v_active = false THEN
    RAISE EXCEPTION 'EVENT_LOCKED: This event is locked (read-only). Unlock it in Events & Config to delete delegates.';
  END IF;

  IF COALESCE((v_cfg ->> 'delegate_deletion_enabled')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'DELETE_DISABLED: Delete is disabled for this event. Enable "Allow Admins to Delete Delegates" in Events & Config first.';
  END IF;

  -- Audit sample (first 5 names) captured BEFORE the rows disappear.
  SELECT string_agg(trim(concat(first_name, ' ', last_name)), ', ' ORDER BY last_name)
  INTO v_sample
  FROM (
    SELECT first_name, last_name
    FROM delegates
    WHERE event_id = p_event_id AND delegate_id = ANY(p_ids)
    ORDER BY last_name
    LIMIT 5
  ) s;

  -- Dependents first (explicit, mirroring the service-layer cascade).
  DELETE FROM checkins          WHERE event_id = p_event_id AND delegate_id = ANY(p_ids);
  DELETE FROM session_responses WHERE event_id = p_event_id AND delegate_id = ANY(p_ids);
  DELETE FROM badge_print_logs  WHERE event_id = p_event_id AND delegate_id = ANY(p_ids);

  DELETE FROM delegates WHERE event_id = p_event_id AND delegate_id = ANY(p_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO audit_log (event_id, action_type, performed_by, performer_email, target_type, target_id, summary, metadata)
  VALUES (
    p_event_id,
    'delegate_delete_bulk',
    auth.uid(),
    nullif(auth.jwt() ->> 'email', ''),
    'delegate',
    p_event_id,
    format('Deleted %s delegate(s) via Master List bulk delete', v_deleted)
      || CASE WHEN v_sample IS NOT NULL THEN ': ' || v_sample ELSE '' END,
    jsonb_build_object('count', v_deleted, 'source', 'master_list_rpc')
  );

  RETURN jsonb_build_object('deleted', v_deleted, 'failedIds', '[]'::jsonb);
END;
$func$;

REVOKE ALL ON FUNCTION public.delete_delegates_bulk(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_delegates_bulk(UUID, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_delegates_bulk(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_delegates_bulk(UUID, UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- PART 4 — verification (read-only, raises on failure)
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_overloads INT;
  v_has_dates BOOLEAN;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates';

  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'v1.92 FAILED: expected exactly 1 get_paginated_delegates, found % (stale overloads would make calls ambiguous)', v_overloads;
  END IF;

  SELECT (p.prosrc LIKE '%p_created_from%') INTO v_has_dates
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates'
  LIMIT 1;

  IF v_has_dates IS NOT TRUE THEN
    RAISE EXCEPTION 'v1.92 FAILED: get_paginated_delegates was not rebuilt with the date-range params';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_delegates_bulk'
  ) THEN
    RAISE EXCEPTION 'v1.92 FAILED: delete_delegates_bulk was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_delegates_event_created_at'
  ) THEN
    RAISE EXCEPTION 'v1.92 FAILED: idx_delegates_event_created_at was not created';
  END IF;

  RAISE NOTICE 'v1.92 OK: date-range RPC (10-arg, single overload), bulk delete RPC and created_at index are in place.';
END;
$verify$;
