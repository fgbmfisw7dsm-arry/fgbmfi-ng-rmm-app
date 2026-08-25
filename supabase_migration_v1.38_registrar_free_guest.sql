-- ============================================================================
-- v1.38 — Registrar Free Guest Restriction (per-event)
--
-- Feature: Events & Config can toggle "Restrict Registrar registrations to
--          Free Guest only" (events.event_config.restrict_registrar_to_free_guest).
--          When ON, registrar-tier roles (national_registrar / regional_registrar /
--          district_registrar / registrar / executive_admin) may only manually
--          INSERT delegates (registration_source = 'manual') whose delegate_type
--          is 'Free Guest'. Admins and event_admin remain unrestricted; QR-scan
--          submissions (registration_source = 'qr_scan') and bulk import (SECURITY
--          DEFINER RPC, admin/event_admin gated) stay open.
--
-- Idempotent: safe to re-apply. Client/service layers mirror this guard:
--   - pages/NewDelegatePage.tsx (UI lock)
--   - services/supabaseService.ts registerDelegate (friendly rejection)
-- ============================================================================

-- Registrar-tier role set (excludes admins + event_admin; mirrors client isRegistrarRole)
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

-- Extend delegates insert policy: registrar-tier manual inserts on a restricted
-- event must carry delegate_type = 'Free Guest' (case-insensitive).
DROP POLICY IF EXISTS "delegates_insert_scoped" ON delegates;
CREATE POLICY "delegates_insert_scoped" ON delegates FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR (
    (district ~~* COALESCE(current_user_district(), ''::text)) AND (current_user_district() IS NOT NULL)
    AND NOT (
      is_registrar_user()
      AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.event_id = delegates.event_id
          AND COALESCE(e.event_config->>'restrict_registrar_to_free_guest', 'false') = 'true'
      )
      AND COALESCE(delegates.registration_source, 'manual') = 'manual'
      AND UPPER(COALESCE(delegates.delegate_type, '')) <> 'FREE GUEST'
    )
  )
);