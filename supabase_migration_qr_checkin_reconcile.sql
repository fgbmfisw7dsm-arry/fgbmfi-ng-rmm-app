-- =============================================================================
-- FGBMFI-EMS — QR Check-In Reconciliation Backstop (v1.51)
-- -----------------------------------------------------------------------------
-- Purpose: DB-level guard for the QR check-in reconciliation fix. The app now
-- resolves a scanned (portal/3rd-party badge) payload to an existing delegate
-- BEFORE offering registration (supabaseService.checkInByCode Pass 4) and
-- canonicalizes districts on the qr_scan insert path. This migration is the
-- final layer of defense-in-depth:
--
--   1) VERIFIES whether the Sprint-21 identity columns + partial unique index
--      (idx_delegates_same_person) are present on the live DB.
--   2) DETECTS (read-only, no deletes) any existing internal duplicate clusters
--      keyed on the identity model.
--   3) INSTALLS the partial unique index ONLY when it is missing AND no
--      duplicate clusters exist, so a qr_scan insert can never create a second
--      person record for the same (event, identity) while respecting the
--      Sprint-21 rule: index AFTER dupes are cleared.
--
-- Safe to re-run: every statement is idempotent / guarded.
-- =============================================================================

-- 1. VERIFY identity columns -------------------------------------------------
DO $$
DECLARE
  v_has_identity_cols boolean := FALSE;
  v_has_name_key boolean := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delegates'
      AND column_name IN ('phone_normalized','title_key','name_first_key','name_last_key')
  ) INTO v_has_identity_cols;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delegates' AND column_name = 'name_key'
  ) INTO v_has_name_key;

  RAISE NOTICE '[QR reconcile] identity columns present: %', v_has_identity_cols;
  RAISE NOTICE '[QR reconcile] name_key column present: %', v_has_name_key;
END $$;

-- 2. DETECT existing duplicate clusters (read-only) --------------------------
DO $$
DECLARE
  v_dupes integer := 0;
  v_has_identity_cols boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delegates'
      AND column_name IN ('phone_normalized','title_key','name_first_key','name_last_key')
  ) INTO v_has_identity_cols;

  IF v_has_identity_cols THEN
    SELECT COUNT(*) INTO v_dupes FROM (
      SELECT event_id, title_key, name_first_key, name_last_key, COALESCE(phone_normalized,'')
      FROM delegates
      WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
      GROUP BY 1, 2, 3, 4, 5
      HAVING COUNT(*) > 1
    ) t;
  END IF;

  RAISE NOTICE '[QR reconcile] internal duplicate clusters (phone-bearing): %', v_dupes;

  IF v_dupes > 0 THEN
    RAISE NOTICE '[QR reconcile] SKIPPING unique index creation — clear internal duplicates first (DataModule > Deduplicate / Reconcile Title Variants), then re-run this migration.';
  END IF;
END $$;

-- 3. INSTALL the partial unique index when safe ---------------------------------------------
DO $$
DECLARE
  v_dupes integer := 0;
  v_index_exists boolean;
  v_has_identity_cols boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delegates'
      AND column_name IN ('phone_normalized','title_key','name_first_key','name_last_key')
  ) INTO v_has_identity_cols;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'delegates' AND indexname = 'idx_delegates_same_person'
  ) INTO v_index_exists;

  IF v_has_identity_cols AND NOT v_index_exists THEN
    SELECT COUNT(*) INTO v_dupes FROM (
      SELECT event_id, title_key, name_first_key, name_last_key, COALESCE(phone_normalized,'')
      FROM delegates
      WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
      GROUP BY 1, 2, 3, 4, 5
      HAVING COUNT(*) > 1
    ) t;

    IF v_dupes = 0 THEN
      CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_same_person
        ON delegates (event_id, title_key, name_first_key, name_last_key, COALESCE(phone_normalized,''))
        WHERE phone_normalized IS NOT NULL;
      RAISE NOTICE '[QR reconcile] CREATE idx_delegates_same_person installed.';
    ELSE
      RAISE NOTICE '[QR reconcile] index NOT created (internal duplicate clusters = %). Clear dupes then re-run.', v_dupes;
    END IF;
  ELSE
    RAISE NOTICE '[QR reconcile] index already present (or identity columns missing) — no action.';
  END IF;
END $$;