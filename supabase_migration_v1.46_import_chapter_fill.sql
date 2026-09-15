-- v1.46 — import_delegates_batch_merge: chapter fill on merge + zone/code-artifact overwrite
-- ------------------------------------------------------------------------------------------
-- Problem (NC2, Sep 2026): a RE-IMPORT of a district manual-reg CSV over already-existing rows
-- reported "N skipped (already complete)" and never populated the Chapter column. Root cause:
-- the merge UPDATE path did not fill blank chapter on existing rows (prior fresh INSERTS always
-- wrote chapter, so early district imports looked fine while later re-imports could not).
--
-- This rebuild folds the three canonical variants into one function:
--   * reg_type-aware (v1.44)  — INSERT + fill-blank SET columns + reg_type defaults
--   * row-guard v2 (v1.30)    — blank/numeric/numeric-leading/'='/<> /summary-token rows are
--                               skipped and can never insert or gap-fill a record
--   * NEW chapter fill        — on BOTH merge UPDATE paths the stored chapter is set to the
--                               incoming value when it is BLANK or is a corruption artifact
--                               (`ZONE 1`/`AREA 3` or a district code like `NC2` left over from
--                               a misaligned import). Legitimate chapter names are never
--                               overwritten (fill-only rule preserved; mirrors the import-time
--                               `cleanChapterName`/zone-strip logic client-side).
-- The change-detection OR list includes the same conditions so corrected rows count as UPDATED.
-- Idempotent CREATE OR REPLACE; re-apply at any time. After deployment, re-import the affected
-- CSV once — existing rows now merge-fill their blank chapters.

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

-- ---------------------------------------------------------------------------
-- OPTIONAL one-time backfill (only if you DO NOT want to re-import the file):
-- fills blank chapter from a loaded NC2-style CSV is NOT possible server-side
-- (chapter comes from the import payload). If re-importing, skip this block.
-- Returns counts of rows the backfill would touch (preview).
--
-- SELECT
--   count(*) FILTER (WHERE btrim(chapter) = '')                         AS blank_chapter,
--   count(*) FILTER (WHERE btrim(chapter) ~* '^(ZONE|AREA)\s*\d+$')     AS zone_artifact,
--   count(*) FILTER (WHERE btrim(chapter) ~* '^[A-Z]{2}\d{1,2}$')       AS code_artifact
-- FROM delegates
-- WHERE district ILIKE '%North Central 2%';