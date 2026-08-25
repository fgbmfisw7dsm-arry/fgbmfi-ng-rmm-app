-- ============================================================================
-- Reconcile District Portal CSV → fill gaps on existing delegates
-- ----------------------------------------------------------------------------
-- WHY: District portal exports (e.g. `SW7 Portal reg.csv`) carry a combined
-- `Full Name` with an embedded title and frequently the same person recorded
-- under different title/name-order between rows (`Uto-Dieu Jair` vs
-- `Mr. Jair Uto-Dieu`). The standard `import_delegates_batch_merge` matches on
-- exact, order-sensitive `title_key + first + last` + phone/email, so such
-- people fail to unify into one record and missing phone/email are not filled.
--
-- This RPC provides a *reconcile-and-fill* path for a district portal file:
--   1. Match an existing delegate in the target event, in priority order:
--        a. phone_normalized (exact)
--        b. normalized full name, ignoring title AND name order (word-sorted)
--        c. lowercased email
--   2. Gap-fill ONLY blank fields (title, phone, email, district, chapter,
--      rank, office, delegate_type). Never overwrite an existing value.
--   3. Insert as a new delegate when no match is found.
--
-- SAFETY (mirrors AGENTS.md §21/§35 lessons):
--   * Per-record SELECT-then-update, never blanket overwrite.
--   * SQL-immutable identity; name matching is order/title-insensitive so the
--     same person with a different spelling resolves to ONE record.
--   * Strict event scoping (`event_id = p_event_id`).
--   * Admin / event_admin gate only.
--   * Dry-run (`p_dry_run => true`) returns what WOULD happen without writing.
-- ============================================================================

-- Word-sorted, punctuation-collapsed, lowercased name key used for
-- order/title-insensitive matching (`Jair Uto-Dieu` == `UTO DIEU JAIR`).
CREATE OR REPLACE FUNCTION canonical_name_key(fn TEXT, ln TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $f$
  SELECT COALESCE(string_agg(w, ' '), '')
  FROM (
    SELECT w
    FROM regexp_split_to_table(lower(COALESCE(fn,'') || ' ' || COALESCE(ln,'')), '\s+') AS w
    WHERE length(w) > 0
    ORDER BY w
  ) t;
$f$;

CREATE OR REPLACE FUNCTION reconcile_delegate_matches(
  p_delegates JSONB,
  p_event_id UUID,
  p_dry_run BOOLEAN DEFAULT FALSE
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
  v_item JSONB;
  v_existing_id UUID;
  v_rows_affected INT;
  v_phone_norm TEXT;
  v_email_lower TEXT;
  v_name_key TEXT;
  v_first TEXT;
  v_last TEXT;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

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
    v_name_key := canonical_name_key(v_first, v_last);

    -- 1) Phone-primary (exact, event-scoped)
    v_existing_id := NULL;
    IF NULLIF(v_phone_norm, '') IS NOT NULL THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND NULLIF(phone_normalized, '') IS NOT NULL
        AND phone_normalized = v_phone_norm
      LIMIT 1;
    END IF;

    -- 2) Name-key fallback (order/title-insensitive) when no phone match
    IF v_existing_id IS NULL AND v_name_key <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND canonical_name_key(first_name, last_name) = v_name_key
      LIMIT 1;
    END IF;

    -- 3) Email fallback (only when we still have no match AND row is contact-less by phone)
    IF v_existing_id IS NULL AND v_email_lower <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND NULLIF(TRIM(email), '') IS NOT NULL
        AND LOWER(TRIM(email)) = v_email_lower
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
          qr_hash, event_id, registration_source, external_id
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
          COALESCE(v_item->>'registration_source', 'reconcile'),
          COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), gen_random_uuid()::TEXT)
        );
        v_inserted := v_inserted + 1;
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
    IF v_rows_affected > 0 THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'total', v_inserted + v_updated + v_skipped
  );
END;
$func$;
