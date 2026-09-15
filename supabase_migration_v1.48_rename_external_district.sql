-- v1.48 — Rename District 'National/External' → 'International/External'
-- ----------------------------------------------------------------------------------------
-- The district holding external/guest delegates was renamed in System Setup
-- (system_settings.districts now lists 'International/External'), but the application and the
-- database still carry the old label in three places:
--   1. delegates.district — existing rows (the 16 external guests and any historical rows)
--      still store 'National/External'. The Master List "All Official Districts" section
--      headers are rendered from the STORED delegate district values (getDistrictsWithDelegates),
--      so until these rows are re-filed the old label continues to appear there. This is the
--      "hardcoded" behaviour observed — it is stale DATA, not a display constant.
--   2. delegates_insert_scoped RLS policy — registrar Free Guest inserts on restricted events
--      are pinned to district = 'National/External'; after the rename that would REJECT new
--      Free Guest registrations (they would file under 'International/External').
--   3. system_settings.districts — reconciled idempotently (removes any stale 'National/External'
--      entry, appends 'International/External' if absent, preserves existing order).
--
-- The frontend constants were updated in the same release: NewDelegatePage FREE_GUEST_DISTRICT,
-- registerDelegate payload force-set, ImportModule GUE → 'International/External', and the
-- empty-settings seed. Apply this file BEFORE/with the frontend deploy so the new label and the
-- data agree. Idempotent — safe to run twice.

-- =====================================================================================
-- 1. Re-file existing delegate rows (all events — the label is a project-wide rename)
-- =====================================================================================
UPDATE delegates
SET district = 'International/External'
WHERE district = 'National/External';

-- =====================================================================================
-- 2. Rebuild the Free Guest insert policy with the new label
--    (mirrors delegates_insert_scoped in supabase_schema.sql §12g / v1.39)
-- =====================================================================================
DROP POLICY IF EXISTS "delegates_insert_scoped" ON delegates;
CREATE POLICY "delegates_insert_scoped" ON delegates FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR (
    NOT (
      is_registrar_user()
      AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.event_id = delegates.event_id
          AND COALESCE(e.event_config->>'restrict_registrar_to_free_guest', 'false') = 'true'
      )
      AND COALESCE(delegates.registration_source, 'manual') = 'manual'
    )
    AND (district ~~* COALESCE(current_user_district(), ''::text)) AND (current_user_district() IS NOT NULL)
  )
  OR (
    is_registrar_user()
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.event_id = delegates.event_id
        AND COALESCE(e.event_config->>'restrict_registrar_to_free_guest', 'false') = 'true'
    )
    AND COALESCE(delegates.registration_source, 'manual') = 'manual'
    AND UPPER(COALESCE(delegates.delegate_type, '')) = 'FREE GUEST'
    AND delegates.district = 'International/External'
  )
);

-- =====================================================================================
-- 3. Reconcile system_settings.districts (removes stale old label, appends new one,
--    preserves existing order)
-- =====================================================================================
DO $$
DECLARE v_districts jsonb;
BEGIN
  SELECT districts INTO v_districts FROM system_settings LIMIT 1;
  IF v_districts IS NULL THEN RETURN; END IF;

  v_districts := (SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                  FROM (SELECT elem FROM jsonb_array_elements_text(v_districts) elem
                        WHERE elem <> 'National/External') t);

  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_districts) elem WHERE elem = 'International/External') THEN
    v_districts := v_districts || '"International/External"'::jsonb;
  END IF;

  UPDATE system_settings SET districts = v_districts;
END $$;

-- =====================================================================================
-- Verification
-- =====================================================================================
-- -- Expect 0 rows:
-- SELECT district, COUNT(*) FROM delegates WHERE district = 'National/External' GROUP BY district;
-- -- Expect the guest rows under the new label:
-- SELECT district, COUNT(*) FROM delegates WHERE district = 'International/External' GROUP BY district;
-- -- Expect 'International/External' present, 'National/External' absent:
-- SELECT districts FROM system_settings;