-- Sprint 7: Row-Level Security (RLS) Policies
-- Run in Supabase SQL Editor after Sprint 6 migration
-- Enforces server-side role-based access control for all tables
-- All RPCs use SECURITY DEFINER and bypass these policies

-- ============================================================
-- 1. ENABLE RLS ON ALL CORE TABLES
-- ============================================================
ALTER TABLE events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pledges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. DROP EXISTING POLICIES (clean slate, preserve chapters)
-- ============================================================
DO $$ DECLARE
  r RECORD;
  tbl TEXT;
BEGIN
  FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public')
  LOOP
    -- Preserve existing chapters policies
    IF r.tablename != 'chapters' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 3. HELPER: Check if current user has admin role
-- ============================================================
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role IN ('national_admin','regional_admin','district_admin','admin')
      AND (is_active IS NULL OR is_active = true)
  );
$$;

-- ============================================================
-- 4. HELPER: Get current user's district (for registrar scoping)
-- ============================================================
CREATE OR REPLACE FUNCTION current_user_district()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT district FROM app_users
  WHERE id = auth.uid()
    AND (is_active IS NULL OR is_active = true)
  LIMIT 1;
$$;

-- ============================================================
-- 5. app_users TABLE POLICIES
-- ============================================================
-- Users can view their own profile
CREATE POLICY "app_users_view_own" ON app_users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Admins can view all profiles
CREATE POLICY "app_users_admin_view_all" ON app_users
  FOR SELECT TO authenticated
  USING (is_admin_user());

-- Users can insert their own profile (initial creation after auth)
CREATE POLICY "app_users_insert_own" ON app_users
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- Only admins can update profiles
CREATE POLICY "app_users_admin_update" ON app_users
  FOR UPDATE TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Only admins can delete profiles (soft-delete handled by RPC)
CREATE POLICY "app_users_admin_delete" ON app_users
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ============================================================
-- 6. events TABLE POLICIES
-- ============================================================
CREATE POLICY "events_select_all" ON events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "events_admin_insert" ON events
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_user());

CREATE POLICY "events_admin_update" ON events
  FOR UPDATE TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

CREATE POLICY "events_admin_delete" ON events
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ============================================================
-- 7. delegates TABLE POLICIES
-- ============================================================
CREATE POLICY "delegates_select_all" ON delegates
  FOR SELECT TO authenticated USING (true);

-- Admins insert any; registrars insert only in their district
CREATE POLICY "delegates_insert_scoped" ON delegates
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin_user()
    OR (
      district ILIKE COALESCE(current_user_district(), '')
      AND current_user_district() IS NOT NULL
    )
  );

-- Admins update any; registrars update only in their district
CREATE POLICY "delegates_update_scoped" ON delegates
  FOR UPDATE TO authenticated
  USING (
    is_admin_user()
    OR (
      district ILIKE COALESCE(current_user_district(), '')
      AND current_user_district() IS NOT NULL
    )
  )
  WITH CHECK (
    is_admin_user()
    OR (
      district ILIKE COALESCE(current_user_district(), '')
      AND current_user_district() IS NOT NULL
    )
  );

-- Only admins can delete delegates
CREATE POLICY "delegates_admin_delete" ON delegates
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ============================================================
-- 8. sessions TABLE POLICIES
-- ============================================================
CREATE POLICY "sessions_select_all" ON sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "sessions_admin_insert" ON sessions
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_user());

CREATE POLICY "sessions_admin_update" ON sessions
  FOR UPDATE TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

CREATE POLICY "sessions_admin_delete" ON sessions
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ============================================================
-- 9. checkins TABLE POLICIES
-- ============================================================
CREATE POLICY "checkins_select_all" ON checkins
  FOR SELECT TO authenticated USING (true);

-- Admins insert any; registrars insert any (check-in is their core function)
CREATE POLICY "checkins_admin_registrar_insert" ON checkins
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin_user()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
        AND (is_active IS NULL OR is_active = true)
    )
  );

-- Only admins can update/delete checkins
CREATE POLICY "checkins_admin_update" ON checkins
  FOR UPDATE TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

CREATE POLICY "checkins_admin_delete" ON checkins
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ============================================================
-- 10. pledges TABLE POLICIES
-- ============================================================
CREATE POLICY "pledges_select_all" ON pledges
  FOR SELECT TO authenticated USING (true);

-- Admins insert any; finance can insert
CREATE POLICY "pledges_admin_finance_insert" ON pledges
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin_user()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('finance')
        AND (is_active IS NULL OR is_active = true)
    )
  );

-- Admins update any; finance can update
CREATE POLICY "pledges_admin_finance_update" ON pledges
  FOR UPDATE TO authenticated
  USING (
    is_admin_user()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('finance')
        AND (is_active IS NULL OR is_active = true)
    )
  )
  WITH CHECK (
    is_admin_user()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('finance')
        AND (is_active IS NULL OR is_active = true)
    )
  );

-- Only admins can delete pledges
CREATE POLICY "pledges_admin_delete" ON pledges
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ============================================================
-- 11. financial_entries TABLE POLICIES
-- ============================================================
CREATE POLICY "financials_select_all" ON financial_entries
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "financials_admin_finance_insert" ON financial_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    is_admin_user()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('finance')
        AND (is_active IS NULL OR is_active = true)
    )
  );

CREATE POLICY "financials_admin_finance_update" ON financial_entries
  FOR UPDATE TO authenticated
  USING (
    is_admin_user()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('finance')
        AND (is_active IS NULL OR is_active = true)
    )
  )
  WITH CHECK (
    is_admin_user()
    OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('finance')
        AND (is_active IS NULL OR is_active = true)
    )
  );

-- Only admins can delete financial entries
CREATE POLICY "financials_admin_delete" ON financial_entries
  FOR DELETE TO authenticated
  USING (is_admin_user());

-- ============================================================
-- 12. system_settings TABLE POLICIES
-- ============================================================
CREATE POLICY "settings_select_all" ON system_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "settings_admin_insert" ON system_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_admin_user());

CREATE POLICY "settings_admin_update" ON system_settings
  FOR UPDATE TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- No DELETE policy needed for system_settings (managed via update only)

-- ============================================================
-- 13. VERIFY
-- ============================================================
SELECT tablename, policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
