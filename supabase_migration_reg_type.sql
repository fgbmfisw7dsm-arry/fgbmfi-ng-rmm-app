-- ============================================================================
-- Reg Type (Manual / Portal / Web) — user-facing registration classification
-- v1.44
--
-- WHY: every delegate pays for a system-generated CON26 external_id, so the
-- Master List "Reg ID" column could not distinguish a real portal/web
-- registration number from a fabricated one. Reg Type is an explicit,
-- operator-chosen classification (selected at upload time, assigned on the New
-- Delegate form, or corrected later via DataModule reclassify) that is
-- independent of the operational `registration_source` channel.
--
--   1) Add delegates.reg_type (NOT NULL, DEFAULT 'manual', CHECK 3 values).
--   2) Backfill existing `registration_source='portal'` rows -> 'portal'
--      (idempotent: flipping an already-correct row to 'portal' is a no-op).
--   3) Rebuild get_paginated_delegates with a trailing p_reg_type param so the
--      Master List Source/Reg Type dropdown filters server-side at 25K.
--   4) Rebuild import_delegates_batch_merge to accept reg_type per row —
--      SET on INSERT, FILL-BLANK-ONLY on the merge UPDATE (a re-upload never
--      clobbers a corrected tag; use DataModule Reclassify to change it).
-- ============================================================================

-- 1) Column ------------------------------------------------------------------
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS reg_type TEXT NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'delegates_reg_type_check' AND conrelid = 'delegates'::regclass
  ) THEN
    ALTER TABLE delegates ADD CONSTRAINT delegates_reg_type_check
      CHECK (reg_type IN ('manual', 'portal', 'web'));
  END IF;
END $$;

-- 2) Backfill ----------------------------------------------------------------
UPDATE delegates SET reg_type = 'portal' WHERE registration_source = 'portal';

-- 3) get_paginated_delegates (8-arg: ... + p_reg_type) -----------------------
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
    OR NOT (p_reg_type IN ('manual', 'portal', 'web'))
    OR (p_reg_type = 'portal' AND reg_type = 'portal')
    OR (p_reg_type = 'web'    AND reg_type = 'web')
    OR (p_reg_type = 'manual' AND COALESCE(reg_type, 'manual') NOT IN ('portal', 'web'))
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
      OR NOT (p_reg_type IN ('manual', 'portal', 'web'))
      OR (p_reg_type = 'portal' AND reg_type = 'portal')
      OR (p_reg_type = 'web'    AND reg_type = 'web')
      OR (p_reg_type = 'manual' AND COALESCE(reg_type, 'manual') NOT IN ('portal', 'web'))
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

-- 4) import_delegates_batch_merge (reg_type-aware) ---------------------------
CREATE OR REPLACE FUNCTION import_delegates_batch_merge(p_delegates JSONB, p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_item JSONB;
  v_existing_id UUID;
  v_rows_affected INT;
  v_phone_norm TEXT;
  v_title_key TEXT;
  v_first_key TEXT;
  v_last_key TEXT;
  v_email_lower TEXT;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    v_phone_norm := normalize_phone_sql(v_item->>'phone');
    v_title_key := normalize_name_key(COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr'));
    v_first_key := normalize_name_key(v_item->>'first_name');
    v_last_key := normalize_name_key(v_item->>'last_name');
    v_email_lower := LOWER(TRIM(COALESCE(v_item->>'email', '')));

    v_existing_id := NULL;
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
    ELSIF v_email_lower <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND title_key = v_title_key
        AND name_first_key = v_first_key
        AND name_last_key = v_last_key
        AND NULLIF(email, '') IS NOT NULL
        AND LOWER(TRIM(email)) = v_email_lower
      LIMIT 1;
    ELSE
      -- No phone AND no email: dedupe by exact identity alone. Prevents
      -- repeated imports of contact-less rows multiplying identical records.
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
          qr_hash, event_id, registration_source, external_id, reg_type
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
          COALESCE(v_item->>'reg_type', 'manual')
        );
        v_inserted := v_inserted + 1;
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
            chapter = CASE WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '' THEN TRIM(v_item->>'chapter') ELSE delegates.chapter END,
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
          IF v_rows_affected > 0 THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      END;
    ELSE
      UPDATE delegates SET
        title = CASE WHEN COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '' THEN TRIM(v_item->>'title') ELSE delegates.title END,
        email = CASE WHEN COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> '' THEN LOWER(TRIM(v_item->>'email')) ELSE delegates.email END,
        district = CASE WHEN COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '' THEN TRIM(v_item->>'district') ELSE delegates.district END,
        chapter = CASE WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '' THEN TRIM(v_item->>'chapter') ELSE delegates.chapter END,
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
          OR (COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '')
          OR (TRIM(COALESCE(v_item->>'delegate_type', '')) IN ('National Guest', 'Free Guest', 'International')
              AND COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') <> TRIM(v_item->>'delegate_type'))
          OR (COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '')
          OR (NULLIF(v_phone_norm, '') IS NOT NULL AND normalize_phone_sql(delegates.phone) = v_phone_norm AND delegates.phone <> v_phone_norm)
        );
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      IF v_rows_affected > 0 THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'total', v_inserted + v_updated + v_skipped
  );
END;
$func$;