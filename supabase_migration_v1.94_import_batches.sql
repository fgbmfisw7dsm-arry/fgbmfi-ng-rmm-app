-- ============================================================================
-- v1.94 — Import batches (exact "reprint what I just uploaded" cohort)
-- ============================================================================
-- Problem: re-uploading a CSV that matches existing delegates writes NOTHING
-- when every field already matches (the merge UPDATE is gated on filling a blank
-- / repairing a corrupt value). No write -> updated_at never moves -> those
-- records are invisible to the v1.93 "Last activity" date range, so they could
-- neither be found in the Master List nor reprinted from Batch Printing.
--
-- Solution: give every row touched by an import a batch marker, and add an
-- "Import batch" filter. Exact cohort, repeatable twice in a day, and it does
-- NOT touch badge_printed_at unless the operator explicitly asks for a reset.
--
--   * delegates.last_import_id / last_imported_at are EXCLUDED from the
--     activity trigger, so stamping an import does not move the activity date.
--     "Activity" keeps meaning "details changed" (v1.93 semantics).
--   * Optional per-import badge reset: 'none' (default) | 'changed' | 'all'.
--
-- Additive + idempotent. Deploy BEFORE the frontend.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PART 1 — import_batches table + RLS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
  label TEXT,
  reg_type TEXT,
  reset_badge TEXT DEFAULT 'none',
  row_count INT DEFAULT 0,
  inserted INT DEFAULT 0,
  updated INT DEFAULT 0,
  skipped INT DEFAULT 0,
  badge_reset INT DEFAULT 0,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_event_created
  ON public.import_batches (event_id, created_at DESC);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batches_select ON public.import_batches;
CREATE POLICY import_batches_select ON public.import_batches
  FOR SELECT USING (is_admin_user() OR is_event_admin_user());

DROP POLICY IF EXISTS import_batches_insert ON public.import_batches;
CREATE POLICY import_batches_insert ON public.import_batches
  FOR INSERT WITH CHECK (is_admin_user() OR is_event_admin_user());

DROP POLICY IF EXISTS import_batches_update ON public.import_batches;
CREATE POLICY import_batches_update ON public.import_batches
  FOR UPDATE USING (is_admin_user() OR is_event_admin_user())
  WITH CHECK (is_admin_user() OR is_event_admin_user());


-- ---------------------------------------------------------------------------
-- PART 2 — delegates batch marker + index
-- ---------------------------------------------------------------------------
ALTER TABLE public.delegates
  ADD COLUMN IF NOT EXISTS last_import_id UUID
  REFERENCES public.import_batches(batch_id) ON DELETE SET NULL;

ALTER TABLE public.delegates
  ADD COLUMN IF NOT EXISTS last_imported_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_delegates_event_last_import
  ON public.delegates (event_id, last_import_id);


-- ---------------------------------------------------------------------------
-- PART 3 — activity trigger: also ignore the import marker
-- Same catalogue-driven comparison as v1.93 (generated columns excluded — a
-- BEFORE trigger sees them unset in NEW but computed in OLD), with
-- last_import_id / last_imported_at added to the ignore list so stamping an
-- import never moves last_activity_at.
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
                               'badge_printed', 'badge_printed_at',
                               'last_import_id', 'last_imported_at')
     AND COALESCE(c.is_generated, 'NEVER') <> 'ALWAYS';

  IF v_compare IS NULL THEN
    RAISE EXCEPTION 'v1.94 FAILED: could not build the delegate column comparison list';
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
-- PART 4 — get_paginated_delegates: + p_import_id (12-arg)
-- ⚠️ DROP the 11-arg first (CREATE OR REPLACE would create an overload).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text);

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
  p_date_basis TEXT DEFAULT 'created',
  p_import_id UUID DEFAULT NULL
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
  )
  AND (p_import_id IS NULL OR last_import_id = p_import_id);

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
    AND (p_import_id IS NULL OR last_import_id = p_import_id)
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

REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_paginated_delegates(integer, integer, text, text, text, uuid, text, text, timestamptz, timestamptz, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- PART 5 — import_delegates_batch_merge v3: batch marker + optional badge reset
-- p_import_id  — stamps every inserted/merged row (NULL = legacy behaviour)
-- p_reset_badge — 'none' (default) | 'changed' (only rows the file filled)
--                 | 'all' (every matched row)
-- ⚠️ DROP the 2-arg signature first.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.import_delegates_batch_merge(jsonb, uuid);

CREATE OR REPLACE FUNCTION import_delegates_batch_merge(
  p_delegates JSONB,
  p_event_id UUID,
  p_import_id UUID DEFAULT NULL,
  p_reset_badge TEXT DEFAULT 'none'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_stamped INT := 0;
  v_badge_reset INT := 0;
  v_item JSONB;
  v_existing_id UUID;
  v_rows_affected INT;
  v_stamp_affected INT;
  v_reset_affected INT;
  v_phone_norm TEXT;
  v_title_key TEXT;
  v_first_key TEXT;
  v_last_key TEXT;
  v_email_lower TEXT;
  v_reset_mode TEXT := CASE
    WHEN LOWER(COALESCE(p_reset_badge, 'none')) IN ('changed', 'all') THEN LOWER(p_reset_badge)
    ELSE 'none'
  END;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    -- Row-quality guard (v2): skip blank / purely-numeric / numeric-leading /
    -- '='/<> -laced / summary-note-token rows so they can never be inserted
    -- or gap-fill a real record.
    IF (
      TRIM(COALESCE(v_item->>'first_name','')) = ''
      AND TRIM(COALESCE(v_item->>'last_name','')) = ''
    )
    OR (
      TRIM(COALESCE(v_item->>'first_name','')) <> ''
      AND TRIM(v_item->>'first_name') !~ '[A-Za-z]'
    )
    OR (
      TRIM(COALESCE(v_item->>'last_name','')) <> ''
      AND TRIM(v_item->>'last_name') !~ '[A-Za-z]'
    )
    OR TRIM(COALESCE(v_item->>'first_name','')) ~ '^\d'
    OR TRIM(COALESCE(v_item->>'last_name','')) ~ '^\d'
    OR TRIM(COALESCE(v_item->>'first_name','')) ~ '[=<>]'
    OR TRIM(COALESCE(v_item->>'last_name','')) ~ '[=<>]'
    OR (UPPER(TRIM(COALESCE(v_item->>'first_name',''))) || ' ' || UPPER(TRIM(COALESCE(v_item->>'last_name',''))))
       ~ '(GRAND TOTAL|ZONE SUMMARY|REGISTRATION RECORDS|SUBTOTAL|SOURCE:|MARKED AS|PER NOTES|AS AT|DATE OF BIRTH|RECORDS|NOTES:|NAIRA|DELIVERABLES|SUMMARY|BATCH |ADULTS|TEENS|CHILDREN|TOTAL|CAT=)'
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_phone_norm := normalize_phone_sql(v_item->>'phone');
    v_title_key := normalize_name_key(COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr'));
    v_first_key := normalize_name_key(v_item->>'first_name');
    v_last_key := normalize_name_key(v_item->>'last_name');
    v_email_lower := LOWER(TRIM(COALESCE(v_item->>'email', '')));

    v_existing_id := NULL;
    -- Identity lookup, chained so a contact-bearing incoming row still merges into a
    -- contact-less existing row instead of inserting a duplicate:
    --   1. phone-primary match (incoming phone present)
    --   2. email match (incoming email present, existing email also present)
    --   3. names-only contact-less fallback
    IF NULLIF(v_phone_norm, '') IS NOT NULL THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND title_key = v_title_key
        AND name_first_key = v_first_key
        AND name_last_key = v_last_key
        AND NULLIF(phone_normalized, '') IS NOT NULL
        AND phone_normalized = v_phone_norm
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL AND v_email_lower <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND title_key = v_title_key
        AND name_first_key = v_first_key
        AND name_last_key = v_last_key
        AND NULLIF(email, '') IS NOT NULL
        AND LOWER(TRIM(email)) = v_email_lower
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND title_key = v_title_key
        AND name_first_key = v_first_key
        AND name_last_key = v_last_key
        AND NULLIF(phone_normalized, '') IS NULL
        AND NULLIF(email, '') IS NULL
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL THEN
      BEGIN
        INSERT INTO delegates (
          title, first_name, last_name, district, chapter,
          phone, email, rank, office, delegate_type,
          qr_hash, event_id, registration_source, external_id, reg_type,
          last_import_id, last_imported_at
        ) VALUES (
          COALESCE(TRIM(v_item->>'title'), ''),
          TRIM(v_item->>'first_name'),
          TRIM(v_item->>'last_name'),
          TRIM(v_item->>'district'),
          TRIM(v_item->>'chapter'),
          v_phone_norm,
          LOWER(TRIM(v_item->>'email')),
          COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), 'CP'),
          COALESCE(NULLIF(TRIM(v_item->>'office'), ''), 'OTHER'),
          COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), 'Member'),
          COALESCE(v_item->>'qr_hash', gen_random_uuid()::TEXT),
          p_event_id,
          COALESCE(v_item->>'registration_source', 'import'),
          COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr')),
          COALESCE(v_item->>'reg_type', 'manual'),
          p_import_id,
          CASE WHEN p_import_id IS NULL THEN NULL ELSE NOW() END
        );
        v_inserted := v_inserted + 1;
        IF p_import_id IS NOT NULL THEN
          v_stamped := v_stamped + 1;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        SELECT delegate_id INTO v_existing_id
        FROM delegates
        WHERE event_id = p_event_id
          AND title_key = v_title_key
          AND name_first_key = v_first_key
          AND name_last_key = v_last_key
          AND COALESCE(phone_normalized, '') = COALESCE(v_phone_norm, '')
        LIMIT 1;

        IF v_existing_id IS NOT NULL THEN
          UPDATE delegates SET
            title = CASE WHEN COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '' THEN TRIM(v_item->>'title') ELSE delegates.title END,
            email = CASE WHEN COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> '' THEN LOWER(TRIM(v_item->>'email')) ELSE delegates.email END,
            district = CASE WHEN COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '' THEN TRIM(v_item->>'district') ELSE delegates.district END,
            chapter = CASE
              WHEN COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') = '' THEN delegates.chapter
              WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' THEN TRIM(v_item->>'chapter')
              WHEN TRIM(delegates.chapter) ~* '^(ZONE|AREA)\s*\d+$' THEN TRIM(v_item->>'chapter')
              WHEN TRIM(delegates.chapter) ~* '^[A-Z]{2}\d{1,2}$' THEN TRIM(v_item->>'chapter')
              ELSE delegates.chapter END,
            rank = CASE WHEN COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '' THEN TRIM(v_item->>'rank') ELSE delegates.rank END,
            office = CASE WHEN COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '' THEN TRIM(v_item->>'office') ELSE delegates.office END,
            delegate_type = CASE
              WHEN TRIM(COALESCE(v_item->>'delegate_type', '')) IN ('National Guest', 'Free Guest', 'International')
                AND COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') <> TRIM(v_item->>'delegate_type')
                THEN TRIM(v_item->>'delegate_type')
              WHEN COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '' THEN TRIM(v_item->>'delegate_type')
              ELSE delegates.delegate_type END,
            phone = CASE WHEN NULLIF(v_phone_norm, '') IS NOT NULL AND normalize_phone_sql(delegates.phone) = v_phone_norm THEN v_phone_norm ELSE delegates.phone END,
            external_id = CASE WHEN COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '' THEN TRIM(v_item->>'external_id') ELSE delegates.external_id END,
            reg_type = CASE WHEN COALESCE(NULLIF(TRIM(delegates.reg_type), ''), '') = '' THEN COALESCE(v_item->>'reg_type', 'manual') ELSE delegates.reg_type END
          WHERE delegate_id = v_existing_id;
          GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

          v_stamp_affected := 0;
          IF p_import_id IS NOT NULL THEN
            UPDATE delegates
               SET last_import_id = p_import_id, last_imported_at = NOW()
             WHERE delegate_id = v_existing_id
               AND last_import_id IS DISTINCT FROM p_import_id;
            GET DIAGNOSTICS v_stamp_affected = ROW_COUNT;
            v_stamped := v_stamped + v_stamp_affected;
          END IF;

          v_reset_affected := 0;
          IF v_reset_mode <> 'none' AND (v_reset_mode = 'all' OR v_rows_affected > 0) THEN
            UPDATE delegates
               SET badge_printed = false, badge_printed_at = NULL
             WHERE delegate_id = v_existing_id
               AND (badge_printed = true OR badge_printed_at IS NOT NULL);
            GET DIAGNOSTICS v_reset_affected = ROW_COUNT;
            v_badge_reset := v_badge_reset + v_reset_affected;
          END IF;

          IF v_rows_affected > 0 OR v_reset_affected > 0 THEN
            v_updated := v_updated + 1;
          ELSE
            v_skipped := v_skipped + 1;
          END IF;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      END;
    ELSE
      UPDATE delegates SET
        title = CASE WHEN COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '' THEN TRIM(v_item->>'title') ELSE delegates.title END,
        email = CASE WHEN COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> '' THEN LOWER(TRIM(v_item->>'email')) ELSE delegates.email END,
        district = CASE WHEN COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '' THEN TRIM(v_item->>'district') ELSE delegates.district END,
        chapter = CASE
          WHEN COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') = '' THEN delegates.chapter
          WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' THEN TRIM(v_item->>'chapter')
          WHEN TRIM(delegates.chapter) ~* '^(ZONE|AREA)\s*\d+$' THEN TRIM(v_item->>'chapter')
          WHEN TRIM(delegates.chapter) ~* '^[A-Z]{2}\d{1,2}$' THEN TRIM(v_item->>'chapter')
          ELSE delegates.chapter END,
        rank = CASE WHEN COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '' THEN TRIM(v_item->>'rank') ELSE delegates.rank END,
        office = CASE WHEN COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '' THEN TRIM(v_item->>'office') ELSE delegates.office END,
        delegate_type = CASE
          WHEN TRIM(COALESCE(v_item->>'delegate_type', '')) IN ('National Guest', 'Free Guest', 'International')
            AND COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') <> TRIM(v_item->>'delegate_type')
            THEN TRIM(v_item->>'delegate_type')
          WHEN COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '' THEN TRIM(v_item->>'delegate_type')
          ELSE delegates.delegate_type END,
        phone = CASE
          WHEN NULLIF(v_phone_norm, '') IS NOT NULL AND normalize_phone_sql(delegates.phone) = v_phone_norm
            THEN v_phone_norm
          ELSE delegates.phone END,
        external_id = CASE WHEN COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '' THEN TRIM(v_item->>'external_id') ELSE delegates.external_id END,
        reg_type = CASE WHEN COALESCE(NULLIF(TRIM(delegates.reg_type), ''), '') = '' THEN COALESCE(v_item->>'reg_type', 'manual') ELSE delegates.reg_type END
      WHERE delegate_id = v_existing_id
        AND (
          (COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> ''
              AND (COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = ''
                   OR TRIM(delegates.chapter) ~* '^(ZONE|AREA)\s*\d+$'
                   OR TRIM(delegates.chapter) ~* '^[A-Z]{2}\d{1,2}$'))
          OR (COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '')
          OR (TRIM(COALESCE(v_item->>'delegate_type', '')) IN ('National Guest', 'Free Guest', 'International')
              AND COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') <> TRIM(v_item->>'delegate_type'))
          OR (COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '')
          OR (NULLIF(v_phone_norm, '') IS NOT NULL AND normalize_phone_sql(delegates.phone) = v_phone_norm AND delegates.phone <> v_phone_norm)
        );
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

      -- v1.94: always link the row to this import batch (does not move the
      -- activity date — last_import_* is excluded from the trigger comparison).
      v_stamp_affected := 0;
      IF p_import_id IS NOT NULL THEN
        UPDATE delegates
           SET last_import_id = p_import_id, last_imported_at = NOW()
         WHERE delegate_id = v_existing_id
           AND last_import_id IS DISTINCT FROM p_import_id;
        GET DIAGNOSTICS v_stamp_affected = ROW_COUNT;
        v_stamped := v_stamped + v_stamp_affected;
      END IF;

      -- v1.94: optional badge-stamp reset ('changed' = only rows the file filled,
      -- 'all' = every matched row).
      v_reset_affected := 0;
      IF v_reset_mode <> 'none' AND (v_reset_mode = 'all' OR v_rows_affected > 0) THEN
        UPDATE delegates
           SET badge_printed = false, badge_printed_at = NULL
         WHERE delegate_id = v_existing_id
           AND (badge_printed = true OR badge_printed_at IS NOT NULL);
        GET DIAGNOSTICS v_reset_affected = ROW_COUNT;
        v_badge_reset := v_badge_reset + v_reset_affected;
      END IF;

      IF v_rows_affected > 0 OR v_reset_affected > 0 THEN
        v_updated := v_updated + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'stamped', v_stamped,
    'badgeReset', v_badge_reset,
    'batch', p_import_id,
    'total', v_inserted + v_updated + v_skipped
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.import_delegates_batch_merge(jsonb, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_delegates_batch_merge(jsonb, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_delegates_batch_merge(jsonb, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_delegates_batch_merge(jsonb, uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- PART 6 — verification
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_pag_overloads INT;
  v_import_overloads INT;
BEGIN
  SELECT count(*) INTO v_pag_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates';
  IF v_pag_overloads <> 1 THEN
    RAISE EXCEPTION 'v1.94 FAILED: expected 1 get_paginated_delegates, found %', v_pag_overloads;
  END IF;

  SELECT count(*) INTO v_import_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'import_delegates_batch_merge';
  IF v_import_overloads <> 1 THEN
    RAISE EXCEPTION 'v1.94 FAILED: expected 1 import_delegates_batch_merge, found %', v_import_overloads;
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE proname = 'touch_delegates_updated_at' LIMIT 1) LIKE '%last_import_id%' THEN
    RAISE EXCEPTION 'v1.94 FAILED: activity trigger still compares the import marker';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delegates' AND column_name = 'last_import_id'
  ) THEN
    RAISE EXCEPTION 'v1.94 FAILED: delegates.last_import_id was not created';
  END IF;

  RAISE NOTICE 'v1.94 OK: import_batches, delegates.last_import_id, batch-aware RPCs and the 12-arg Master List RPC are in place.';
END;
$verify$;
