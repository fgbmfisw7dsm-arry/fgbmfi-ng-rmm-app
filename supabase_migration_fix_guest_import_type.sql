-- FIX: Guest Delegate Type on bulk import re-run (idempotent; run in Supabase SQL Editor)
--
-- Why: the previous import_delegates_batch_merge only gap-filled EMPTY delegate_type.
-- Guests that were mis-classified as 'Member' could not be corrected by re-importing the
-- guest CSV (rows were matched and skipped because no field was empty).
--
-- This recreation adds an overwrite rule: when the incoming delegate_type is a recognized
-- guest type (National Guest / Free Guest / International) and differs from the stored
-- value, the stored value is replaced. Re-importing the guest CSV after applying this
-- migration corrects the Delegate Type field in place.
--
-- The client-side mapping (ImportModule.tsx) emits these canonical values at column 11
-- regardless of which form fields the event hides (stable 11-column contract).

CREATE OR REPLACE FUNCTION import_delegates_batch_merge(p_delegates JSONB, p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_item JSONB;
  v_existing_id UUID;
  v_rows_affected INT;
BEGIN
  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    SELECT delegate_id INTO v_existing_id
    FROM delegates
    WHERE event_id = p_event_id
      AND UPPER(TRIM(first_name)) = UPPER(TRIM(v_item->>'first_name'))
      AND UPPER(TRIM(last_name)) = UPPER(TRIM(v_item->>'last_name'))
      AND COALESCE(phone, '') = COALESCE(TRIM(v_item->>'phone'), '')
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO delegates (
        title, first_name, last_name, district, chapter,
        phone, email, rank, office, delegate_type,
        qr_hash, event_id, registration_source, external_id
      ) VALUES (
        COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr'),
        TRIM(v_item->>'first_name'),
        TRIM(v_item->>'last_name'),
        TRIM(v_item->>'district'),
        TRIM(v_item->>'chapter'),
        TRIM(v_item->>'phone'),
        LOWER(TRIM(v_item->>'email')),
        COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), 'CP'),
        COALESCE(NULLIF(TRIM(v_item->>'office'), ''), 'OTHER'),
        COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), 'Member'),
        COALESCE(v_item->>'qr_hash', gen_random_uuid()::TEXT),
        p_event_id,
        COALESCE(v_item->>'registration_source', 'import'),
        COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr'))
      );
      v_inserted := v_inserted + 1;
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
        external_id = CASE WHEN COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '' THEN TRIM(v_item->>'external_id') ELSE delegates.external_id END
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