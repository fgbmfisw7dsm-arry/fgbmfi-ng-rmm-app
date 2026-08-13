-- MIGRATION: Event Admin Role (v1.8)
-- Adds a new GLOBAL (unscoped) 'event_admin' role: registrar-level modules
-- (Check-In, Session Details, New Delegate, Reports) + Badge Printing + Master List.
-- Intentionally NOT added to is_admin_user() so admin-only modules stay locked.

-- 1. Extend app_users role check constraint
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN (
    'national_admin','regional_admin','district_admin','admin',
    'national_registrar','regional_registrar','district_registrar','registrar',
    'finance','event_admin'
));

-- 2. Helper: is_event_admin_user()
CREATE OR REPLACE FUNCTION is_event_admin_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role = 'event_admin'
      AND (is_active IS NULL OR is_active = true)
  );
$func$;

-- 3. Delegates: allow event admin (global) insert + update
DROP POLICY IF EXISTS "delegates_insert_scoped" ON delegates;
CREATE POLICY "delegates_insert_scoped" ON delegates FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR is_event_admin_user()
    OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL));

DROP POLICY IF EXISTS "delegates_update_scoped" ON delegates;
CREATE POLICY "delegates_update_scoped" ON delegates FOR UPDATE TO authenticated
    USING (is_admin_user() OR is_event_admin_user()
        OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL))
    WITH CHECK (is_admin_user() OR is_event_admin_user()
        OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL));

-- 4. Checkins: allow event admin to insert
DROP POLICY IF EXISTS "checkins_admin_registrar_insert" ON checkins;
CREATE POLICY "checkins_admin_registrar_insert" ON checkins FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR is_event_admin_user() OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
        AND (is_active IS NULL OR is_active = true)));

-- 5. Session ministry: allow event admin to insert responses/summaries/voice
DROP POLICY IF EXISTS "sr_insert" ON session_responses;
CREATE POLICY "sr_insert" ON session_responses
    FOR INSERT TO authenticated
    WITH CHECK (
        is_admin_user() OR is_event_admin_user() OR EXISTS (
            SELECT 1 FROM app_users WHERE id = auth.uid()
            AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
            AND (is_active IS NULL OR is_active = true)
        )
    );

DROP POLICY IF EXISTS "srs_insert" ON session_response_summaries;
CREATE POLICY "srs_insert" ON session_response_summaries
    FOR INSERT TO authenticated
    WITH CHECK (
        is_admin_user() OR is_event_admin_user() OR EXISTS (
            SELECT 1 FROM app_users WHERE id = auth.uid()
            AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
            AND (is_active IS NULL OR is_active = true)
        )
    );

DROP POLICY IF EXISTS "svd_insert" ON session_voice_distribution;
CREATE POLICY "svd_insert" ON session_voice_distribution
    FOR INSERT TO authenticated
    WITH CHECK (
        is_admin_user() OR is_event_admin_user() OR EXISTS (
            SELECT 1 FROM app_users WHERE id = auth.uid()
            AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
            AND (is_active IS NULL OR is_active = true)
        )
    );

-- 6. Badge batches: allow event admin to generate (insert + update)
DROP POLICY IF EXISTS "Admin can insert badge batches" ON badge_batches;
CREATE POLICY "Admin can insert badge batches"
  ON badge_batches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin', 'national_registrar', 'regional_registrar', 'event_admin')
    )
  );

DROP POLICY IF EXISTS "Admin can update badge batches" ON badge_batches;
CREATE POLICY "Admin can update badge batches"
  ON badge_batches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin', 'national_registrar', 'regional_registrar', 'event_admin')
    )
  );

-- 7. Badge print logs: allow event admin to insert
DROP POLICY IF EXISTS "Admin and registrar can insert print logs" ON badge_print_logs;
CREATE POLICY "Admin and registrar can insert print logs"
  ON badge_print_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin', 'national_registrar', 'regional_registrar', 'district_registrar', 'registrar', 'event_admin')
    )
  );
