-- ============================================================================
-- v1.50 — Delegate-Type → District Routing (Guest + International split)
-- ----------------------------------------------------------------------------
-- Supersedes the hardcoded guest-district label (v1.39 'National/External',
-- v1.48 'International/External', manual rename to 'International/Guest').
--
-- Business rule (confirmed with product owner):
--   * Free Guest + National Guest ("Paid Guest")  → 'Guest' district
--   * International                               → 'International' district
--   * Member / Dependant-*                        → keep entered district
--
-- The routing is now configuration-driven from a NEW single-row column
--   system_settings.delegate_type_districts (JSONB map type → district label),
-- editable in System Setup, so future label renames require NO code or SQL:
--   Setup rename cascades districts[], the routing-map targets, and re-files
--   delegates.district rows via the admin renameDistrict() service method.
--
-- RLS (delegates_insert_scoped) now references get_delegate_type_district('Free
-- Guest') instead of a literal, so restricted-registrar Free Guest inserts never
-- break on a label rename.
--
-- Idempotent — safe to run twice. Apply BEFORE/with the frontend deploy.
-- ============================================================================

-- =====================================================================================
-- 1. Add the routing map column
-- =====================================================================================
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS delegate_type_districts JSONB NOT NULL DEFAULT '{}'::jsonb;

-- =====================================================================================
-- 2. Reconcile districts[] (TEXT[] — array ops, NOT jsonb): drop legacy guest
--    labels, append 'Guest' + 'International' if absent, preserve existing order.
-- =====================================================================================
DO $$
DECLARE v_districts text[];
        v_map jsonb;
BEGIN
  SELECT districts INTO v_districts FROM system_settings LIMIT 1;
  IF v_districts IS NULL THEN RETURN; END IF;

  v_districts := array_remove(v_districts, 'National/External');
  v_districts := array_remove(v_districts, 'International/External');
  v_districts := array_remove(v_districts, 'International/Guest');

  IF NOT ('Guest' = ANY(v_districts)) THEN
    v_districts := v_districts || ARRAY['Guest'];
  END IF;

  IF NOT ('International' = ANY(v_districts)) THEN
    v_districts := v_districts || ARRAY['International'];
  END IF;

  UPDATE system_settings SET districts = v_districts;

  -- Seed routing map keys that are missing (admin may later repoint targets).
  SELECT delegate_type_districts INTO v_map FROM system_settings LIMIT 1;
  IF v_map IS NULL THEN v_map := '{}'::jsonb; END IF;
  IF NOT (v_map ? 'Free Guest') THEN v_map := v_map || jsonb_build_object('Free Guest', 'Guest'); END IF;
  IF NOT (v_map ? 'National Guest') THEN v_map := v_map || jsonb_build_object('National Guest', 'Guest'); END IF;
  IF NOT (v_map ? 'International') THEN v_map := v_map || jsonb_build_object('International', 'International'); END IF;
  UPDATE system_settings SET delegate_type_districts = v_map;
END $$;

-- =====================================================================================
-- 3. Re-file EXISTING delegate rows (all events) that sit under the legacy
--    guest district labels, splitting by delegate_type.
--    Conservative: rows not under a guest/legacy label are left untouched.
-- =====================================================================================
-- Optional preview before applying:
-- SELECT delegate_type, district, COUNT(*) FROM delegates
-- WHERE UPPER(COALESCE(district,'')) IN ('NATIONAL/EXTERNAL','INTERNATIONAL/EXTERNAL','INTERNATIONAL/GUEST','GUEST','INTERNATIONAL')
-- GROUP BY 1,2 ORDER BY 3 DESC;

-- 3a. International-type rows under any guest/legacy or 'Guest' label → 'International'
UPDATE delegates
SET district = 'International'
WHERE UPPER(COALESCE(delegate_type,'')) = 'INTERNATIONAL'
  AND UPPER(COALESCE(district,'')) IN ('NATIONAL/EXTERNAL','INTERNATIONAL/EXTERNAL','INTERNATIONAL/GUEST','GUEST');

-- 3b. All other rows under a legacy guest label → 'Guest'
UPDATE delegates
SET district = 'Guest'
WHERE UPPER(COALESCE(district,'')) IN ('NATIONAL/EXTERNAL','INTERNATIONAL/EXTERNAL','INTERNATIONAL/GUEST')
  AND UPPER(COALESCE(delegate_type,'')) <> 'INTERNATIONAL';

-- 3c. Guest-type rows (Free/National Guest) mis-filed under 'International' → 'Guest'
UPDATE delegates
SET district = 'Guest'
WHERE UPPER(COALESCE(delegate_type,'')) IN ('FREE GUEST','NATIONAL GUEST')
  AND UPPER(COALESCE(district,'')) = 'INTERNATIONAL';

-- =====================================================================================
-- 4. Dynamic district resolver used by RLS (no literal labels anywhere)
-- =====================================================================================
CREATE OR REPLACE FUNCTION get_delegate_type_district(p_type TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT delegate_type_districts->>p_type FROM system_settings LIMIT 1;
$func$;

GRANT EXECUTE ON FUNCTION get_delegate_type_district(TEXT) TO authenticated;

-- =====================================================================================
-- 5. Rebuild delegates_insert_scoped to reference the configured Free Guest
--    district (mirrors §12g in supabase_schema.sql / v1.39 pattern)
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
    AND delegates.district ILIKE COALESCE(get_delegate_type_district('Free Guest'), '')
  )
);

-- =====================================================================================
-- Verification
-- =====================================================================================
-- -- Expect 'Guest' and 'International' present, legacy labels absent:
-- SELECT districts FROM system_settings;
-- -- Expect routing map seeded:
-- SELECT delegate_type_districts FROM system_settings;
-- -- Expect guest rows under 'Guest' / 'International' (no legacy labels remain):
-- SELECT UPPER(district) AS district, COUNT(*) FROM delegates
-- WHERE UPPER(COALESCE(district,'')) IN ('NATIONAL/EXTERNAL','INTERNATIONAL/EXTERNAL','INTERNATIONAL/GUEST','GUEST','INTERNATIONAL')
-- GROUP BY 1 ORDER BY 2 DESC;
-- -- Expect resolver returns configured guest label:
-- SELECT get_delegate_type_district('Free Guest');