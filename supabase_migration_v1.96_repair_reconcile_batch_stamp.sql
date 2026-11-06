-- ============================================================================
-- v1.96 — Import-batch stamping for the Reconcile + Repair tools
-- ============================================================================
-- v1.94 stamped rows processed by the BULK IMPORT. The other two ways delegates
-- enter or change (Reconcile District Portal CSV, Repair Imported Names) did not
-- create a batch, so their cohorts could not be retrieved with the
-- "Import batch" filter.
--
--   * reconcile_delegate_matches gains p_import_id (4-arg; the 3-arg overload is
--     DROPPED first). Inserted rows are stamped; matched rows are stamped even
--     when the gap-fill changed nothing (same semantic as the bulk import).
--     Stamping does NOT move last_activity_at (last_import_* is excluded from
--     the activity trigger — v1.94).
--   * repairNamesFromFile is CLIENT-SIDE and needs no SQL change; the caller
--     passes the batch id and the update payload carries the marker.
--
-- Idempotent. Deploy BEFORE the frontend (the client falls back to the 3-arg
-- call if this has not been applied).
-- ============================================================================

DROP FUNCTION IF EXISTS public.reconcile_delegate_matches(jsonb, uuid, boolean);

CREATE OR REPLACE FUNCTION reconcile_delegate_matches(
  p_delegates JSONB,
  p_event_id UUID,
  p_dry_run BOOLEAN DEFAULT FALSE,
  p_import_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_stamped INT := 0;
  v_item JSONB;
  v_existing_id UUID;
  v_rows_affected INT;
  v_stamp_affected INT;
  v_phone_norm TEXT;
  v_email_lower TEXT;
  v_name_key TEXT;
  v_first TEXT;
  v_last TEXT;
  v_district TEXT;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

  PERFORM set_config('statement_timeout', '120000', true);

  IF COALESCE(p_event_id, '00000000-0000-0000-0000-000000000000'::UUID) = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'Reconcile requires a valid target event';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    IF NULLIF(TRIM(v_item->>'first_name'), '') IS NULL AND NULLIF(TRIM(v_item->>'last_name'), '') IS NULL
       AND NULLIF(TRIM(v_item->>'phone'), '') IS NULL AND NULLIF(TRIM(v_item->>'email'), '') IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_phone_norm := normalize_phone_sql(v_item->>'phone');
    v_email_lower := LOWER(TRIM(COALESCE(v_item->>'email', '')));
    v_first := TRIM(COALESCE(v_item->>'first_name', ''));
    v_last := TRIM(COALESCE(v_item->>'last_name', ''));
    v_name_key := delegate_match_key(v_item->>'title', v_first, v_last);

    -- 1) Phone-primary (exact, event-scoped, uses phone_normalized index)
    v_existing_id := NULL;
    IF NULLIF(v_phone_norm, '') IS NOT NULL THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND NULLIF(phone_normalized, '') IS NOT NULL
        AND phone_normalized = v_phone_norm
      LIMIT 1;
    END IF;

    -- 2) Name-key fallback (family-aware, district-scoped)
    v_district := TRIM(COALESCE(v_item->>'district', ''));
    IF v_existing_id IS NULL AND v_name_key <> '|' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND name_key = v_name_key
        AND (v_district = '' OR lower(btrim(coalesce(delegates.district, ''))) = lower(btrim(v_district)))
      LIMIT 1;
    END IF;

    -- 3) Email fallback (only when still unmatched, district-scoped too)
    IF v_existing_id IS NULL AND v_email_lower <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND NULLIF(TRIM(email), '') IS NOT NULL
        AND LOWER(TRIM(email)) = v_email_lower
        AND (v_district = '' OR lower(btrim(coalesce(delegates.district, ''))) = lower(btrim(v_district)))
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL THEN
      IF p_dry_run THEN
        v_inserted := v_inserted + 1;
        CONTINUE;
      END IF;
      BEGIN
        INSERT INTO delegates (
          title, first_name, last_name, district, chapter,
          phone, email, rank, office, delegate_type,
          qr_hash, event_id, registration_source, external_id,
          last_import_id, last_imported_at
        ) VALUES (
          COALESCE(TRIM(v_item->>'title'), ''),
          v_first,
          v_last,
          TRIM(v_item->>'district'),
          TRIM(v_item->>'chapter'),
          v_phone_norm,
          v_email_lower,
          COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), 'CP'),
          COALESCE(NULLIF(TRIM(v_item->>'office'), ''), 'OTHER'),
          COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), 'Member'),
          COALESCE(v_item->>'qr_hash', gen_random_uuid()::TEXT),
          p_event_id,
          COALESCE(v_item->>'registration_source', 'import'),
          COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), gen_random_uuid()::TEXT),
          p_import_id,
          CASE WHEN p_import_id IS NULL THEN NULL ELSE NOW() END
        );
        v_inserted := v_inserted + 1;
        IF p_import_id IS NOT NULL THEN
          v_stamped := v_stamped + 1;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        v_skipped := v_skipped + 1;
      END;
      CONTINUE;
    END IF;

    -- Matched: gap-fill only blank fields (never overwrite non-blank values).
    IF p_dry_run THEN
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    UPDATE delegates SET
      title = CASE WHEN COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '' THEN TRIM(v_item->>'title') ELSE delegates.title END,
      email = CASE WHEN COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND v_email_lower <> '' THEN v_email_lower ELSE delegates.email END,
      district = CASE WHEN COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '' THEN TRIM(v_item->>'district') ELSE delegates.district END,
      chapter = CASE WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '' THEN TRIM(v_item->>'chapter') ELSE delegates.chapter END,
      rank = CASE WHEN COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '' THEN TRIM(v_item->>'rank') ELSE delegates.rank END,
      office = CASE WHEN COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '' THEN TRIM(v_item->>'office') ELSE delegates.office END,
      delegate_type = CASE
        WHEN COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '' THEN TRIM(v_item->>'delegate_type')
        ELSE delegates.delegate_type END,
      phone = CASE
        WHEN COALESCE(NULLIF(TRIM(delegates.phone), ''), '') = '' AND NULLIF(v_phone_norm, '') IS NOT NULL THEN v_phone_norm
        ELSE delegates.phone END
    WHERE delegate_id = v_existing_id
      AND (
        (COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND v_email_lower <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '')
        OR (COALESCE(NULLIF(TRIM(delegates.phone), ''), '') = '' AND NULLIF(v_phone_norm, '') IS NOT NULL)
      );
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    -- v1.96: link the matched row to this reconcile batch (does not move the
    -- activity date — last_import_* is excluded from the activity trigger).
    IF p_import_id IS NOT NULL THEN
      UPDATE delegates
         SET last_import_id = p_import_id, last_imported_at = NOW()
       WHERE delegate_id = v_existing_id
         AND last_import_id IS DISTINCT FROM p_import_id;
      GET DIAGNOSTICS v_stamp_affected = ROW_COUNT;
      v_stamped := v_stamped + v_stamp_affected;
    END IF;

    IF v_rows_affected > 0 THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'stamped', v_stamped,
    'batch', p_import_id,
    'total', v_inserted + v_updated + v_skipped
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.reconcile_delegate_matches(jsonb, uuid, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_delegate_matches(jsonb, uuid, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_delegate_matches(jsonb, uuid, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_delegate_matches(jsonb, uuid, boolean, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verification
DO $verify$
DECLARE
  v_overloads INT;
BEGIN
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'reconcile_delegate_matches';

  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'v1.96 FAILED: expected 1 reconcile_delegate_matches, found %', v_overloads;
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE proname = 'reconcile_delegate_matches' LIMIT 1) NOT LIKE '%p_import_id%' THEN
    RAISE EXCEPTION 'v1.96 FAILED: reconcile_delegate_matches was not rebuilt with p_import_id';
  END IF;

  RAISE NOTICE 'v1.96 OK: reconcile_delegate_matches stamps import batches (4-arg, single overload).';
END;
$verify$;
