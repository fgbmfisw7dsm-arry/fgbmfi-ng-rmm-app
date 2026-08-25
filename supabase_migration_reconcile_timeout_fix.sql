-- ============================================================================
-- Reconcile District Portal CSV — TIMEOUT + PERFORMANCE FIX (v1.37b)
-- ----------------------------------------------------------------------------
-- WHY: the v1 release of `reconcile_delegate_matches` matched the name fallback
-- via `WHERE canonical_name_key(first_name, last_name) = v_name_key`, which
-- computes the key expression on EVERY row of the target event for EVERY input
-- row (an unindexed full scan). With ~605 portal rows against a large event
-- table, that exceeded Supabase's default `statement_timeout` →
-- "canceling statement due to statement timeout".
--
-- FIX (two layers):
--   1. Persist the word-sorted name key as `delegates.name_key`, populated by
--      the existing identity trigger, and index `(event_id, name_key)` so the
--      fallback becomes an index probe instead of a full scan.
--   2. Raise the per-call `statement_timeout` inside the RPC (session-local via
--      set_config) so large reconcile batches complete instead of being killed.
--
-- Deployment: idempotent. Creates the column/trigger-backfill/index, then
-- CREATE OR REPLACEs the RPC. Requires `pg_trgm` only if not already present
-- (the name_key btree index does not depend on pg_trgm).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Canonical word-sorted name key function (order/title-insensitive identity)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. Add delegates.name_key + index + trigger hook
-- ---------------------------------------------------------------------------
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS name_key TEXT;

-- Backfill existing rows (safe: recomputed from stored first/last)
UPDATE delegates SET name_key = canonical_name_key(first_name, last_name)
WHERE name_key IS NULL OR name_key = '';

-- Populate on insert/update of name fields
CREATE OR REPLACE FUNCTION delegates_name_key_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.name_key := canonical_name_key(NEW.first_name, NEW.last_name);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_delegates_name_key ON delegates;
CREATE TRIGGER trg_delegates_name_key
BEFORE INSERT OR UPDATE OF first_name, last_name ON delegates
FOR EACH ROW EXECUTE FUNCTION delegates_name_key_trigger();

CREATE INDEX IF NOT EXISTS idx_delegates_event_name_key
  ON delegates(event_id, name_key);

-- ---------------------------------------------------------------------------
-- 3. Rewrite reconcile_delegate_matches (indexed + longer statement timeout)
-- ---------------------------------------------------------------------------
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

  -- Surpass the default (pooler) statement_timeout for large reconcile batches.
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
    v_name_key := canonical_name_key(v_first, v_last);

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

    -- 2) Name-key fallback (order/title-insensitive) — indexed name_key probe
    IF v_existing_id IS NULL AND v_name_key <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND name_key = v_name_key
      LIMIT 1;
    END IF;

    -- 3) Email fallback (only when still unmatched)
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
