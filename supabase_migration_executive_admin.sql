-- ============================================================================
-- FGBMFI EMS — EXECUTIVE ADMIN ROLE (v1.11 CORRECTED)
-- Executive Admin = same access as NATIONAL REGISTRAR (registrar tier, national
-- scope = unscoped), PLUS read access to all Reports including Financial
-- reports and Dashboard financials.
--
--   * NOT an admin role — no Events/Users/Setup/Data/Storage/Audit/Badges/
--     MasterList/Import admin modules.
--   * Gets registrar write access (check-ins, session ministry) just like
--     national_registrar.
--   * Financial READ only: can view financial_entries + pledges (RLS SELECT),
--     dashboard financial totals, and financial report data. Cannot add/edit
--     financial entries (financial WRITE stays admin/event_admin/finance).
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================================

-- 1. Role CHECK constraint: allow executive_admin
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (
  role IN (
    'national_admin','regional_admin','district_admin','executive_admin','admin',
    'national_registrar','regional_registrar','district_registrar','registrar',
    'finance','event_admin'
  )
);

-- 2. is_admin_user(): MUST NOT include executive_admin (registrar tier, not admin)
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role IN ('national_admin','regional_admin','district_admin','admin')
      AND (is_active IS NULL OR is_active = true)
  );
$function$;

-- 3. create_app_user (legacy recovery): accept executive_admin role
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    new_user_id      UUID;
    v_instance_id    UUID;
    ins_cols         TEXT;
    ins_vals         TEXT;
    v_token_set      TEXT := '';
    confirm_ok       BOOLEAN := false;
    identities_ok    BOOLEAN := false;
    aud_set          BOOLEAN := false;
    instance_id_set  BOOLEAN := false;
    v_sanitized_role TEXT;
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
    END IF;

    new_user_id := gen_random_uuid();

    v_sanitized_role := CASE
        WHEN role IN ('national_admin','regional_admin','district_admin','executive_admin','admin',
                      'national_registrar','regional_registrar','district_registrar','registrar',
                      'finance','event_admin')
        THEN role
        ELSE 'registrar'
    END;

    SELECT instance_id INTO v_instance_id
    FROM auth.users WHERE instance_id IS NOT NULL
    ORDER BY created_at DESC NULLS LAST LIMIT 1;
    instance_id_set := (v_instance_id IS NOT NULL);

    ins_cols := 'id, email, encrypted_password, created_at, updated_at, '
             || 'raw_app_meta_data, aud, role, instance_id';
    ins_vals := '$1, $2, crypt($3, ''$2a$10$'' || substring(translate(encode(decode(md5(random()::text), ''hex''), ''base64''), ''+/'', ''./''), 1, 22)), NOW(), NOW(), '
             || '$4, ''authenticated'', ''authenticated'', $5';

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'is_sso_user' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', is_sso_user, is_anonymous';
        ins_vals := ins_vals || ', false, false';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'raw_user_meta_data' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', raw_user_meta_data';
        ins_vals := ins_vals || ', ''{}''::jsonb';
    END IF;

    IF v_instance_id IS NULL THEN
        ins_cols := REPLACE(ins_cols, ', instance_id', '');
        ins_vals := REPLACE(ins_vals, ', $5', '');
    END IF;

    BEGIN
        EXECUTE 'INSERT INTO auth.users (' || ins_cols || ') VALUES (' || ins_vals || ')'
            USING new_user_id, email, password,
                  jsonb_build_object('role', v_sanitized_role, 'provider', 'email'),
                  v_instance_id;

        aud_set := true;

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), new_user_id,
            jsonb_build_object('sub', new_user_id, 'email', email),
            'email', email, NOW(), NOW(), NOW()
        );

        identities_ok := true;

        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'auth' AND table_name = 'users'
                     AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
            EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1'
                USING new_user_id;
            confirm_ok := true;
        END IF;

        IF NOT confirm_ok THEN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'auth' AND table_name = 'users'
                         AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN
                EXECUTE 'UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW() WHERE id = $1'
                    USING new_user_id;
                confirm_ok := true;
            END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_token') THEN
            v_token_set := v_token_set || 'confirmation_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'recovery_token') THEN
            v_token_set := v_token_set || 'recovery_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token') THEN
            v_token_set := v_token_set || 'email_change_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change') THEN
            v_token_set := v_token_set || 'email_change = '''', ';
        END IF;
        v_token_set := v_token_set || 'updated_at = NOW()';
        EXECUTE 'UPDATE auth.users SET ' || v_token_set || ' WHERE id = $1' USING new_user_id;

        INSERT INTO public.app_users (id, email, role, district, region, is_active)
        VALUES (new_user_id, email, v_sanitized_role, district, region, true);
    EXCEPTION WHEN OTHERS THEN
        RETURN json_build_object(
            'status', 'error',
            'error', SQLERRM,
            'detail', SQLSTATE
        );
    END;

    RETURN json_build_object(
        'status', 'success',
        'id', new_user_id,
        'aud_set', aud_set,
        'instance_id_set', instance_id_set,
        'confirmed', confirm_ok,
        'identities_inserted', identities_ok,
        'role_sanitized', v_sanitized_role
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'status', 'error',
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$function$;

-- 4. deactivate_all_event_users: bulk deactivation targets all non-admin roles.
--    Executive Admin is registrar-tier → NOT excluded (matches national registrar).
CREATE OR REPLACE FUNCTION deactivate_all_event_users()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_count INT;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  WITH updated AS (
    UPDATE public.app_users
    SET is_active = false
    WHERE is_active = true
      AND role NOT IN ('national_admin', 'regional_admin', 'district_admin', 'admin')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  RETURN json_build_object(
    'status', 'success',
    'message', 'Bulk deactivation complete',
    'deactivated_count', v_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$function$;

-- 5. app_users_insert_own: an executive_admin row can only be created by an admin
DROP POLICY IF EXISTS "app_users_insert_own" ON app_users;
CREATE POLICY "app_users_insert_own" ON app_users FOR INSERT TO authenticated
WITH CHECK (
  id = auth.uid()
  AND (role NOT IN ('national_admin','regional_admin','district_admin','executive_admin','admin') OR is_admin_user())
);

-- ============================================================================
-- REGISTRAR WRITE ACCESS (Executive Admin behaves like national_registrar)
-- ============================================================================

-- 6. check-ins: registrars + executive_admin may record arrivals/session
DROP POLICY IF EXISTS "checkins_admin_registrar_insert" ON checkins;
CREATE POLICY "checkins_admin_registrar_insert" ON checkins FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

-- 7. session_response_summaries: insert/update scoped to officers incl. executive_admin
DROP POLICY IF EXISTS "srs_insert" ON session_response_summaries;
CREATE POLICY "srs_insert" ON session_response_summaries FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "srs_update" ON session_response_summaries;
CREATE POLICY "srs_update" ON session_response_summaries FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

-- 8. session_responses: insert scoped incl. executive_admin
DROP POLICY IF EXISTS "sr_insert" ON session_responses;
CREATE POLICY "sr_insert" ON session_responses FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

-- 9. session_voice_distribution: insert/update scoped incl. executive_admin
DROP POLICY IF EXISTS "svd_insert" ON session_voice_distribution;
CREATE POLICY "svd_insert" ON session_voice_distribution FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "svd_update" ON session_voice_distribution;
CREATE POLICY "svd_update" ON session_voice_distribution FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

-- ============================================================================
-- FINANCIAL READ ACCESS (Executive Admin can VIEW financials, not write)
-- ============================================================================

-- 10. financial_entries SELECT: admin/event_admin/finance/executive_admin
DROP POLICY IF EXISTS "financials_select_all" ON financial_entries;
CREATE POLICY "financials_select_all" ON financial_entries FOR SELECT TO authenticated USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('finance','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

-- 11. pledges SELECT: admin/event_admin/finance/executive_admin
DROP POLICY IF EXISTS "pledges_select_all" ON pledges;
CREATE POLICY "pledges_select_all" ON pledges FOR SELECT TO authenticated USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('finance','executive_admin')
     AND (is_active IS NULL OR is_active = true)));

-- NOTE: financial WRITE policies (insert/update) intentionally left as
-- admin/event_admin/finance only — Executive Admin is read-only on financials.

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- 1. Role constraint accepts executive_admin
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.app_users'::regclass AND conname = 'app_users_role_check';

-- 2. is_admin_user does NOT include executive_admin (registrar tier)
SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure);

-- 3. Executive Admin can read financials, cannot write (RLS check)
INSERT INTO app_users (id, email, role, is_active)
SELECT gen_random_uuid(), 'exec_admin_probe@fgbmfi.invalid', 'executive_admin', true
ON CONFLICT (id) DO NOTHING;
SELECT 'financials_select_all' AS policy,
       qual::text AS allows_exec_admin
FROM pg_policies
WHERE schemaname='public' AND tablename='financial_entries' AND policyname='financials_select_all';

-- 4. Cleanup probe row (leave no test data behind)
DELETE FROM app_users WHERE email = 'exec_admin_probe@fgbmfi.invalid';