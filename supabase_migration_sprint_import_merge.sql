-- ============================================================================
-- Migration: Import Merge (Smart Upsert + Per-Event Dedup)
-- Purpose: Replace import_delegates_batch (skip-only dedup) with
--          import_delegates_batch_merge (gap-fill update on match)
-- Date: 2026-08-07
-- ============================================================================

-- Drop the old RPC
DROP FUNCTION IF EXISTS import_delegates_batch(JSONB);

-- Create the new merge RPC with per-event dedup scoping
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
    -- Per-event dedup: match by name + phone, scoped to active event
    SELECT delegate_id INTO v_existing_id
    FROM delegates
    WHERE event_id = p_event_id
      AND UPPER(TRIM(first_name)) = UPPER(TRIM(v_item->>'first_name'))
      AND UPPER(TRIM(last_name)) = UPPER(TRIM(v_item->>'last_name'))
      AND COALESCE(phone, '') = COALESCE(TRIM(v_item->>'phone'), '')
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      -- No existing match: INSERT new record
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
      -- Existing match found: attempt single UPDATE to gap-fill only NULL/empty fields
      -- Each field's CASE expression preserves existing non-empty data,
      -- only populates NULL/empty fields when the CSV has a non-empty value.
      -- The WHERE clause ensures the UPDATE only fires when at least one field
      -- actually needs gap-filling (avoids no-op UPDATES).
      UPDATE delegates SET
        title = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.title), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> ''
          THEN TRIM(v_item->>'title')
          ELSE delegates.title
        END,
        email = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.email), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> ''
          THEN LOWER(TRIM(v_item->>'email'))
          ELSE delegates.email
        END,
        district = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.district), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> ''
          THEN TRIM(v_item->>'district')
          ELSE delegates.district
        END,
        chapter = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> ''
          THEN TRIM(v_item->>'chapter')
          ELSE delegates.chapter
        END,
        rank = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> ''
          THEN TRIM(v_item->>'rank')
          ELSE delegates.rank
        END,
        office = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.office), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> ''
          THEN TRIM(v_item->>'office')
          ELSE delegates.office
        END,
        delegate_type = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> ''
          THEN TRIM(v_item->>'delegate_type')
          ELSE delegates.delegate_type
        END,
        external_id = CASE
          WHEN COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> ''
          THEN TRIM(v_item->>'external_id')
          ELSE delegates.external_id
        END
      WHERE delegate_id = v_existing_id
        AND (
          (COALESCE(NULLIF(TRIM(delegates.title), ''), '') = ''
           AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.email), ''), '') = ''
              AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.district), ''), '') = ''
              AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = ''
              AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = ''
              AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.office), ''), '') = ''
              AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = ''
              AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = ''
              AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '')
        );

      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

      IF v_rows_affected > 0 THEN
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
    'total', v_inserted + v_updated + v_skipped
  );
END;
$func$;
