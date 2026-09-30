-- ============================================================================
-- FGBMFI EMS — HARDENING PASS 3: RLS role+district SELECT scoping + auth gates
-- ----------------------------------------------------------------------------
-- Closes the two highest-risk data-exposure holes found in the 2026-09 review:
--   1. delegates / checkins SELECT policies were "USING (true)" for ALL
--      authenticated users -> any district registrar could bulk-extract the
--      full national registry (names, phones, emails, payment amounts) via the
--      PostgREST API, bypassing the client-side district scoping entirely.
--   2. app_users self-insert could be used to self-provision elevated roles
--      (event_admin / exec_registrar / executive_admin were absent from the
--      blocked-role list), and any class of user could call
--      confirm_user_by_email to auto-confirm arbitrary accounts.
--
-- Behavioural contract (matches the app's getScopeFilter access model):
--   * Admins, Event Admin, and all national-scope roles (national_admin,
--     national_registrar, executive_admin, exec_registrar) -> full SELECT.
--   * Regional roles -> rows whose delegates.district matches their region.
--   * District roles -> rows whose delegates.district matches their district.
--   * Finance -> no raw delegate/checkin rows (they use the gated SECURITY
--     DEFINER aggregate RPCs; row-level PII is not part of their module).
--
-- Idempotent. Run in the Supabase SQL Editor. Frontend requires NO code change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_region()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $func$
  SELECT region FROM app_users
  WHERE id = auth.uid()
    AND (is_active IS NULL OR is_active = true)
  LIMIT 1;
$func$;

CREATE OR REPLACE FUNCTION is_national_role_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $func$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role IN ('national_admin','national_registrar','executive_admin','exec_registrar')
      AND (is_active IS NULL OR is_active = true)
  );
$func$;

GRANT EXECUTE ON FUNCTION current_user_region() TO authenticated;
GRANT EXECUTE ON FUNCTION is_national_role_user() TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. delegates SELECT: role + district scoping
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "delegates_select_all" ON delegates;
DROP POLICY IF EXISTS "delegates_select_scoped" ON delegates;
CREATE POLICY "delegates_select_scoped" ON delegates FOR SELECT TO authenticated USING (
    is_admin_user()
    OR is_event_admin_user()
    OR is_national_role_user()
    OR (current_user_district() IS NOT NULL AND district ILIKE current_user_district())
    OR (current_user_region() IS NOT NULL AND district ILIKE current_user_region() || '%')
);

-- ----------------------------------------------------------------------------
-- 3. checkins SELECT: scoped via the delegate's district (indexed delegate_id)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "checkins_select_all" ON checkins;
DROP POLICY IF EXISTS "checkins_select_scoped" ON checkins;
CREATE POLICY "checkins_select_scoped" ON checkins FOR SELECT TO authenticated USING (
    is_admin_user()
    OR is_event_admin_user()
    OR is_national_role_user()
    OR EXISTS (
        SELECT 1 FROM delegates
        WHERE delegates.delegate_id = checkins.delegate_id
          AND ( (current_user_district() IS NOT NULL AND delegates.district ILIKE current_user_district())
             OR (current_user_region() IS NOT NULL AND delegates.district ILIKE current_user_region() || '%') )
    )
);

-- ----------------------------------------------------------------------------
-- 4. app_users self-insert: never self-provision elevated roles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "app_users_insert_own" ON app_users;
CREATE POLICY "app_users_insert_own" ON app_users FOR INSERT TO authenticated WITH CHECK (
    id = auth.uid() AND (
        role NOT IN ('national_admin','regional_admin','district_admin','admin',
                     'executive_admin','event_admin','exec_registrar')
        OR is_admin_user()
    )
);

-- ----------------------------------------------------------------------------
-- 5. confirm_user_by_email: admin-only (any authenticated user could otherwise
--    auto-confirm arbitrary accounts + inject identity rows)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_user_by_email(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_uid UUID;
    v_confirmed BOOLEAN := false;
    v_identity_ensured BOOLEAN := false;
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
    END IF;

    SELECT id INTO v_uid FROM auth.users WHERE lower(trim(email)) = lower(trim(p_email));
    IF v_uid IS NULL THEN
        RETURN json_build_object('status', 'error', 'error', 'User not found', 'email', p_email);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'email_confirmed_at') THEN
        EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1'
            USING v_uid;
        v_confirmed := true;
    END IF;

    IF NOT v_confirmed AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'confirmed_at') THEN
        EXECUTE 'UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = $1'
            USING v_uid;
        v_confirmed := true;
    END IF;

    IF NOT v_confirmed THEN
        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || '{"email_verified": true}'::jsonb
        WHERE id = v_uid;
        v_confirmed := true;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid AND provider = 'email') THEN
        INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
        VALUES (gen_random_uuid(), v_uid,
                jsonb_build_object('sub', v_uid::text, 'email', lower(trim(p_email))),
                'email', lower(trim(p_email)), NOW(), NOW(), NOW());
        v_identity_ensured := true;
    END IF;

    RETURN json_build_object(
        'status', 'success',
        'user_id', v_uid,
        'confirmed', true,
        'identity_ensured', v_identity_ensured
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'status', 'error',
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. check_login_account: lock to service_role (kills the anonymous
--    account-enumeration / password-check oracle exposed by earlier grants)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.check_login_account(TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. VERIFICATION (read-only)
-- ----------------------------------------------------------------------------
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('delegates','checkins','app_users')
-- ORDER BY tablename, cmd;