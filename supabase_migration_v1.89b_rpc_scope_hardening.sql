-- ============================================================================
-- v1.89b — RPC SCOPE HARDENING (S1 + S2)
-- ----------------------------------------------------------------------------
-- Closes two SECURITY DEFINER functions that bypassed Row Level Security.
--
--   S1  get_paginated_delegates  — the Master List RPC. It was DEFINER with NO
--       caller scope, so ANY authenticated account could call it directly and
--       page the entire national delegate registry (names, phones, emails,
--       payment_amount, payment_reference) regardless of role or district.
--       FIX: convert to SECURITY INVOKER. RLS (delegates_select_scoped) then
--       applies exactly as it does for every direct table read. The 8-argument
--       body is preserved BYTE-IDENTICAL from
--       supabase_migration_search_v3_prefix.sql:173 — only the security mode
--       changes, so search/pagination/reg_type behaviour is untouched.
--
--   S2  get_event_export_data    — DEFINER, no caller scope, AND its delegates
--       sub-select had NO event_id filter at all, so it returned every delegate
--       across every event plus one event's check-ins/financials/pledges.
--       FIX: DROP it. The client (getAllDataForExport, supabaseService.ts:2237)
--       already try/catches this RPC and falls back to a paginated, strictly
--       event-scoped fetch — which is the path that has actually been running in
--       production (the schema notes record that the JSON variant was never
--       deployed). Dropping it is therefore a no-op in production and removes
--       the dump on any environment where it does exist.
--
-- BEHAVIOUR IMPACT FOR LEGITIMATE USERS: none.
--   The only callers of get_paginated_delegates are MasterListModule (route
--   ADMIN_AND_EVENT_ADMIN) and DataModule (/admin/data, admin only). Those roles
--   pass delegates_select_scoped unconditionally, so their result sets are
--   identical before and after. Non-privileged roles simply stop seeing rows
--   they were never entitled to.
--
-- Idempotent. Safe to re-run.
-- Deploy BEFORE the matching frontend build (frontend-first is also harmless —
-- the client never depended on the unscoped behaviour).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Drop legacy overloads so exactly ONE get_paginated_delegates remains.
--    (Mirrors the v1.74b/§74 guidance: multiple overloads with defaulted args
--    make PostgREST resolution ambiguous.)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_paginated_delegates(integer, integer, text, text, uuid);
DROP FUNCTION IF EXISTS public.get_paginated_delegates(integer, integer, text, text, text, uuid, text);

-- ----------------------------------------------------------------------------
-- 2) get_paginated_delegates — SECURITY INVOKER (8-arg signature preserved)
-- ----------------------------------------------------------------------------
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

-- Re-assert the grant surface (unchanged semantics, anon never had it).
REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) get_event_export_data — remove the cross-event delegate dump (S2)
--    The client falls back to a strictly event-scoped paginated fetch.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_event_export_data(uuid);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION (read-only — run after applying)
-- ============================================================================
-- 1. Exactly one overload, and it is INVOKER:
--    SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
--    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates';
--    -- expect: prosecdef = false, a single 8-argument row
--
-- 2. The dump is gone:
--    SELECT count(*) FROM pg_proc WHERE proname = 'get_event_export_data';
--    -- expect: 0
--
-- 3. RLS is genuinely in force (run while signed in as a district registrar —
--    NOT from the SQL editor, which is postgres and bypasses RLS):
--    SELECT (get_paginated_delegates(1, 5, NULL, NULL, NULL,
--            '<EVENT_UUID>', NULL, NULL))->>'total';
--    -- expect: only that district's count (previously: national total)
--
-- 4. Admin results unchanged (run as an admin login):
--    the Master List count for the same event must equal the previous total.
-- ============================================================================
