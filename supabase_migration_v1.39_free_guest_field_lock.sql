-- ============================================================================
-- v1.39 — Free Guest field lock: District = 'National/External', Chapter = 'Guest'
--
-- Supersedes the v1.38 delegates_insert_scoped policy. When
-- events.event_config.restrict_registrar_to_free_guest = true:
--   * A registrar-tier role (non-admin/non-event-admin) may manually INSERT a
--     delegate ONLY when delegate_type = 'Free Guest' AND district =
--     'National/External' (chapter = 'Guest' is forced client/service-side).
--   * The normal district-scoped insert path is disabled for registrar MANUAL
--     inserts on restricted events, so a registrar cannot route around the
--     lock (e.g., Free Guest into a different district, or Member into their own).
--   * QR-scan submissions (registration_source = 'qr_scan') and bulk import
--     (SECURITY DEFINER, admin/event_admin gated) remain open; QR inserts still
--     enforce the standard district scoping for registrars.
--
-- Idempotent: safe to re-apply. Mirrors pages/NewDelegatePage.tsx +
-- services/supabaseService.ts registerDelegate.
-- ============================================================================

CREATE OR REPLACE FUNCTION is_registrar_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
      AND (is_active IS NULL OR is_active = true)
  );
$func$;

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
    AND delegates.district = 'National/External'
  )
);