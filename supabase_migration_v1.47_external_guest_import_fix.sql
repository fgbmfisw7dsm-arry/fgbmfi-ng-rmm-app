-- v1.47 — import merge: chained names-only fallback + External Delegates duplicate cleanup
-- ----------------------------------------------------------------------------------------
-- Part 1 (essential): import_delegates_batch_merge previously branched its identity lookup
--   on the INCOMING row's contact data — phone present → phone lookup, else email present →
--   email lookup, else names-only contact-less lookup. The names-only branch only ran when
--   the incoming row had NO email. Once the import mapper began tagging the External
--   Delegates CSV's RegisteredBy value into Email (blank Email column fallback), re-imports
--   over the 16 pre-existing contact-less `National/External | Guest` rows entered the email
--   branch, found no existing email-bearing row, and INSERTED a duplicate per person.
--   Fix: chain phone → email → names-only contact-less lookups so a contact-bearing incoming
--   row still merges into a contact-less existing row (title+first+last identity, same event)
--   and gap-fills its blank email instead of duplicating. Idempotent CREATE OR REPLACE.
--
-- Part 2 (data repair for the 32→16 duplication already on the live DB): each of the 16
--   affected people now exists twice in the event — one contact-less original + one
--   email-bearing duplicate. This removes the contact-less twin (keeping the email-bearing
--   row) ONLY when it shares full identity with an email-bearing row in the same event's
--   `National/External` district and has zero attendance/badge history. Backs up every
--   deleted row first. Safe to run twice (second run is a no-op).
--
-- Deployment: run the WHOLE file once in the Supabase SQL editor after the frontend that
--   tags RegisteredBy emails is live. There is no re-import step required for the emails —
--   the surviving rows already carry them. Re-imports afterward are true no-ops.

-- =====================================================================================
-- PART 1 — RPC fix
-- =====================================================================================
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
    -- Identity lookup, chained so a contact-bearing incoming row still merges into a
    -- contact-less existing row instead of inserting a duplicate:
    --   1. phone-primary match (incoming phone present)
    --   2. email match (incoming email present, existing email also present)
    --   3. names-only contact-less fallback (existing row has no phone AND no email) —
    --      runs even when the incoming row carries contact data, so re-importing an
    --      external/guest CSV (now tagging RegisteredBy emails) gap-fills the originals
    --      instead of multiplying records (Sep 2026 regression).
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
      -- No phone AND no email on a matching existing row: dedupe by exact identity
      -- alone. Prevents repeated imports of contact-less rows multiplying identical
      -- records (works regardless of whether the incoming row carries contact data).
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

-- =====================================================================================
-- PART 2 — remove the duplicate contact-less twins left by the regression
-- =====================================================================================
-- Preview (optional, run this SELECT first to eyeball the exact rows that will be removed):
--   SELECT d.delegate_id, d.first_name, d.last_name, d.created_at
--   FROM delegates d
--   WHERE d.district = 'National/External'
--     AND NULLIF(d.phone_normalized, '') IS NULL
--     AND NULLIF(d.email, '') IS NULL
--     AND EXISTS (
--       SELECT 1 FROM delegates s
--       WHERE s.event_id = d.event_id
--         AND s.title_key = d.title_key
--         AND s.name_first_key = d.name_first_key
--         AND s.name_last_key = d.name_last_key
--         AND s.district = 'National/External'
--         AND s.delegate_id <> d.delegate_id
--         AND NULLIF(s.email, '') IS NOT NULL
--     )
--     AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id)
--     AND NOT EXISTS (SELECT 1 FROM session_responses sr WHERE sr.delegate_id = d.delegate_id)
--     AND NOT EXISTS (SELECT 1 FROM badge_print_logs bpl WHERE bpl.delegate_id = d.delegate_id);

DROP TABLE IF EXISTS external_delegates_dupe_backup_20260915;

CREATE TABLE external_delegates_dupe_backup_20260915 (LIKE delegates INCLUDING ALL);

INSERT INTO external_delegates_dupe_backup_20260915
SELECT d.*
FROM delegates d
WHERE d.district = 'National/External'
  AND NULLIF(d.phone_normalized, '') IS NULL
  AND NULLIF(d.email, '') IS NULL
  AND EXISTS (
    SELECT 1 FROM delegates s
    WHERE s.event_id = d.event_id
      AND s.title_key = d.title_key
      AND s.name_first_key = d.name_first_key
      AND s.name_last_key = d.name_last_key
      AND s.district = 'National/External'
      AND s.delegate_id <> d.delegate_id
      AND NULLIF(s.email, '') IS NOT NULL
  )
  AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id)
  AND NOT EXISTS (SELECT 1 FROM session_responses sr WHERE sr.delegate_id = d.delegate_id)
  AND NOT EXISTS (SELECT 1 FROM badge_print_logs bpl WHERE bpl.delegate_id = d.delegate_id);

DELETE FROM delegates d
USING external_delegates_dupe_backup_20260915 b
WHERE d.delegate_id = b.delegate_id;