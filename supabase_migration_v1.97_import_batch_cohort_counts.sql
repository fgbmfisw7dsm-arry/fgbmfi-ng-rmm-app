-- ============================================================================
-- v1.97 — Import batch cohort counts (delegates vs rows) + junk accounting
-- ============================================================================
-- Why: an import reports "13 added + 6 skipped (19 rows)" while the batch cohort
-- can be 18 delegates. That is correct (two rows can be ONE person under the
-- identity rule, or a row can be rejected), but nothing on screen says so — the
-- batch dropdown showed "19 rows" and the banner called the distinct count
-- "rows".
--
--   * import_batches.stamped = distinct delegates linked to the batch (19 rows
--     -> 18 delegates is then explicit). Backfilled once for existing batches.
--   * import_delegates_batch_merge returns `junk` separately, so invalid/summary
--     rows are no longer reported as "already complete".
--   * Same 4-arg signature -> a plain CREATE OR REPLACE, no overload risk.
--
-- Idempotent. Deploy before the frontend (which tolerates its absence).
-- ============================================================================

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS stamped INT;

-- One-shot backfill: the batch marker is the authoritative membership.
UPDATE public.import_batches b
   SET stamped = (
         SELECT count(*) FROM public.delegates d WHERE d.last_import_id = b.batch_id
       )
 WHERE b.stamped IS NULL;

CREATE INDEX IF NOT EXISTS idx_delegates_event_last_import
  ON public.delegates (event_id, last_import_id);


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
  v_junk INT := 0;
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
    -- Row-quality guard (v2). Counted in BOTH v_skipped (progress) and v_junk
    -- (reporting), so the UI can say "invalid row ignored" instead of pretending
    -- it was an already-complete delegate.
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
      v_junk := v_junk + 1;
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
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'junk', v_junk,
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

-- Verification
DO $verify$
DECLARE
  v_overloads INT;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'import_delegates_batch_merge';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'v1.97 FAILED: expected 1 import_delegates_batch_merge, found %', v_overloads;
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE proname = 'import_delegates_batch_merge' LIMIT 1) NOT LIKE '%v_junk%' THEN
    RAISE EXCEPTION 'v1.97 FAILED: import RPC was not rebuilt with junk accounting';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'import_batches' AND column_name = 'stamped'
  ) THEN
    RAISE EXCEPTION 'v1.97 FAILED: import_batches.stamped was not created';
  END IF;

  RAISE NOTICE 'v1.97 OK: import batch cohort counts + junk accounting are in place.';
END;
$verify$;
