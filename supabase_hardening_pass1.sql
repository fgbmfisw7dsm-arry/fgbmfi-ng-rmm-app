-- ============================================================================
-- FGBMFI EMS — SECURITY HARDENING PASS 1 (privilege lockdown + RPC guards + RLS)
-- Run this ENTIRE block in the Supabase SQL Editor (SQL Editor → Run).
-- Idempotent: safe to re-run.
--
-- Fixes the following vulnerabilities (see audit report):
--   C1  anon/PUBLIC EXECUTE on every SECURITY DEFINER function
--   C2  anon/authenticated can call admin-provisioning + password RPCs
--   C3  app_users self-INSERT allows privilege escalation to admin
--   C4  SECURITY DEFINER data RPCs bypass RLS for anonymous users
--   C5  mass import RPC callable without authorization
--   H1  financials/pledges SELECT open to all authenticated users
--   H2  check_login_account is an account/password oracle for anon
--   H4  deleted_users table has RLS disabled (PII exposure)
--   H5  chapters registry writable by any authenticated user
--
-- IMPORTANT notes on schema drift:
--   * Data RPCs (get_paginated_delegates, get_event_dashboard_stats,
--     get_event_export_data, get_session_ministry_stats,
--     get_ministry_export_data) drifted across sprints. Their bodies are NOT
--     rewritten here — they are only privilege-locked (REVOKE anon/PUBLIC,
--     GRANT authenticated/service_role). This preserves live behavior while
--     closing the anonymous attack surface.
--   * Management RPC bodies are stable (master schema = latest deployed) and
--     ARE rewritten below to add in-function authorization guards.
-- ============================================================================

-- ============================================================================
-- SECTION 1 — PRIVILEGE LOCKDOWN (fixes C1, C2-ancel, C4, C5)
-- Revoke EXECUTE on ALL public-schema functions from anon + PUBLIC, then
-- re-grant to authenticated + service_role. Signature-agnostic: robust to drift.
-- ============================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.oid::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.oid::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.oid::regprocedure);
  END LOOP;
END $$;

-- Re-grant to the roles the application uses.
-- (authenticated = logged-in officers; service_role = future server-side code)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- ============================================================================
-- SECTION 2 — check_login_account: DELETE the anon/authenticated oracle (H2)
-- Only service_role (or a human with the postgres/service key) may run it.
-- Login UX is preserved: diagnoseLoginFailure() already catches the RPC
-- permission error and falls back to GoTrue's "Invalid login credentials".
-- ============================================================================
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_login_account(TEXT, TEXT) TO service_role;

-- ============================================================================
-- SECTION 3 — AUTHORIZATION GUARDS FOR MANAGEMENT RPCs (fixes C2)
-- Stable bodies preserved verbatim; only a role guard is added at the top.
-- ============================================================================

-- 3a. create_app_user (legacy recovery; guard to admins)
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
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
        WHEN role IN ('national_admin','regional_admin','district_admin','admin',
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
$func$;

-- 3b. delete_app_user (guard to admins)
CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_uid UUID;
  v_email TEXT;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  v_uid := user_id_to_delete::uuid;
  SELECT email INTO v_email FROM public.app_users WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  INSERT INTO public.deleted_users (id, email) VALUES (v_uid, v_email)
  ON CONFLICT (id) DO UPDATE SET deleted_at = NOW();
  DELETE FROM public.app_users WHERE id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
  RETURN json_build_object('status', 'success', 'message', 'Account permanently removed');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3c. reset_user_password (guard to admins; bcrypt cost 10 preserved)
CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
    v_uid   UUID;
    v_found BOOLEAN;
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
    END IF;

    v_uid := user_id::uuid;
    UPDATE auth.users
    -- GoTrue requires bcrypt cost >= 10. NEVER use gen_salt('bf').
    SET encrypted_password = crypt(new_password, '$2a$10$' || substring(translate(encode(decode(md5(random()::text), 'hex'), 'base64'), '+/', './'), 1, 22)),
        updated_at = NOW()
    WHERE id = v_uid;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF NOT v_found THEN
        RETURN json_build_object('status', 'error', 'error', 'User not found');
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
        EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1 AND email_confirmed_at IS NULL'
            USING v_uid;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN
        EXECUTE 'UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, email_confirmed_at, NOW()) WHERE id = $1 AND confirmed_at IS NULL'
            USING v_uid;
    END IF;

    RETURN json_build_object('status', 'success', 'message', 'Password updated');
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('status', 'error', 'error', SQLERRM);
END;
$func$;

-- 3d. deactivate_app_user (guard to admins)
CREATE OR REPLACE FUNCTION deactivate_app_user(user_id TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  UPDATE public.app_users SET is_active = false WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account deactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3e. reactivate_app_user (guard to admins)
CREATE OR REPLACE FUNCTION reactivate_app_user(user_id TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  UPDATE public.app_users SET is_active = true WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account reactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3f. deactivate_all_event_users (guard to admins)
CREATE OR REPLACE FUNCTION deactivate_all_event_users()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
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
$func$;

-- 3g. auto_confirm_user (guard to admins)
CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_confirmed BOOLEAN := false;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
    EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id;
    v_confirmed := true;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN
    EXECUTE 'UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id;
    v_confirmed := true;
  END IF;
  EXECUTE 'UPDATE auth.users SET confirmation_token = '''', confirmation_sent_at = COALESCE(confirmation_sent_at, NOW()), recovery_token = '''', email_change_token = '''', email_change = '''', updated_at = NOW() WHERE id = $1' USING user_id;
  RETURN json_build_object('status', 'success', 'confirmed', v_confirmed);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'ok', 'message', SQLERRM);
END;
$func$;

-- 3h. confirm_user_by_email (guard to admins — used by db.createUser as admin)
CREATE OR REPLACE FUNCTION confirm_user_by_email(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
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
$func$;

-- 3i. import_delegates_batch_merge (guard to admins + event_admins; latest body)
CREATE OR REPLACE FUNCTION import_delegates_batch_merge(p_delegates JSONB, p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  v_inserted INT := 0;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_item JSONB;
  v_existing_id UUID;
  v_rows_affected INT;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    SELECT delegate_id INTO v_existing_id
    FROM delegates
    WHERE event_id = p_event_id
      AND UPPER(TRIM(first_name)) = UPPER(TRIM(v_item->>'first_name'))
      AND UPPER(TRIM(last_name)) = UPPER(TRIM(v_item->>'last_name'))
      AND COALESCE(phone, '') = COALESCE(TRIM(v_item->>'phone'), '')
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO delegates (
        title, first_name, last_name, district, chapter,
        phone, email, rank, office, delegate_type,
        qr_hash, event_id, registration_source, external_id
      ) VALUES (
        COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr'),
        TRIM(v_item->>'first_name'),
        TRIM(v_item->>'last_name'),
        TRIM(v_item->>'district'),
        TRIM(v_item->>'chapter'),
        TRIM(v_item->>'phone'),
        LOWER(TRIM(v_item->>'email')),
        COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), 'CP'),
        COALESCE(NULLIF(TRIM(v_item->>'office'), ''), 'OTHER'),
        COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), 'Member'),
        COALESCE(v_item->>'qr_hash', gen_random_uuid()::TEXT),
        p_event_id,
        COALESCE(v_item->>'registration_source', 'import'),
        COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr'))
      );
      v_inserted := v_inserted + 1;
    ELSE
      UPDATE delegates SET
        title = CASE WHEN COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '' THEN TRIM(v_item->>'title') ELSE delegates.title END,
        email = CASE WHEN COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> '' THEN LOWER(TRIM(v_item->>'email')) ELSE delegates.email END,
        district = CASE WHEN COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '' THEN TRIM(v_item->>'district') ELSE delegates.district END,
        chapter = CASE WHEN COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '' THEN TRIM(v_item->>'chapter') ELSE delegates.chapter END,
        rank = CASE WHEN COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '' THEN TRIM(v_item->>'rank') ELSE delegates.rank END,
        office = CASE WHEN COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '' THEN TRIM(v_item->>'office') ELSE delegates.office END,
        delegate_type = CASE
          WHEN TRIM(COALESCE(v_item->>'delegate_type', '')) IN ('National Guest', 'Free Guest', 'International')
            AND COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') <> TRIM(v_item->>'delegate_type')
            THEN TRIM(v_item->>'delegate_type')
          WHEN COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '' THEN TRIM(v_item->>'delegate_type')
          ELSE delegates.delegate_type END,
        external_id = CASE WHEN COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '' THEN TRIM(v_item->>'external_id') ELSE delegates.external_id END
      WHERE delegate_id = v_existing_id
        AND (
          (COALESCE(NULLIF(TRIM(delegates.title), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'title'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.email), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'email'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.district), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'district'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.chapter), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'chapter'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.rank), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'rank'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.office), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'office'), ''), '') <> '')
          OR (COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'delegate_type'), ''), '') <> '')
          OR (TRIM(COALESCE(v_item->>'delegate_type', '')) IN ('National Guest', 'Free Guest', 'International')
              AND COALESCE(NULLIF(TRIM(delegates.delegate_type), ''), '') <> TRIM(v_item->>'delegate_type'))
          OR (COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '')
        );
      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      IF v_rows_affected > 0 THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'total', v_inserted + v_updated + v_skipped
  );
END;
$func$;

-- ============================================================================
-- SECTION 3j — FINANCIAL GATE: get_event_dashboard_stats (fixes H1-by-RPC)
-- Body = sprint13 (latest, p_region variant). total_financials is only computed
-- for admins / event admins / finance. All other officers get 0 for that field.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_event_dashboard_stats(
  p_event_id UUID,
  p_district TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  total_delegates BIGINT;
  total_checkins BIGINT;
  total_arrivals BIGINT;
  total_session_attendance BIGINT;
  total_financials BIGINT;
  rank_counts JSON;
  district_counts JSON;
  recent_activity JSON;
  norm_district TEXT;
  norm_region TEXT;
BEGIN
  norm_district := CASE WHEN p_district IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g')) ELSE NULL END;
  norm_region := CASE WHEN p_region IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_region), '\s+', ' ', 'g')) ELSE NULL END;

  IF norm_region IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id
      AND UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) LIKE norm_region || '%';
  ELSIF norm_district IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id
      AND UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = norm_district;
  ELSE
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE event_id = p_event_id;
  END IF;

  SELECT COUNT(DISTINCT c.delegate_id) INTO total_checkins
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND (
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
      )
    );

  SELECT COUNT(DISTINCT c.delegate_id) INTO total_arrivals
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND c.session_id IS NULL
    AND (
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
      )
    );

  SELECT COUNT(*) INTO total_session_attendance
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
  WHERE c.event_id = p_event_id
    AND c.session_id IS NOT NULL
    AND (
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
      )
    );

  -- Financial gate: only admins / event admins / finance may see financial totals
  IF is_admin_user() OR is_event_admin_user()
     OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)) THEN
    SELECT COALESCE(SUM(amount), 0) INTO total_financials
    FROM financial_entries
    WHERE event_id = p_event_id;
  ELSE
    total_financials := 0;
  END IF;

  SELECT COALESCE(json_object_agg(rnk, cnt), '{}'::JSON) INTO rank_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER') AS rnk, COUNT(DISTINCT c.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE c.event_id = p_event_id
      AND (
        norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
        OR
        norm_region IS NULL AND (
          norm_district IS NULL OR
          UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
        )
      )
    GROUP BY COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER')
  ) sub;

  SELECT COALESCE(json_object_agg(distname, cnt), '{}'::JSON) INTO district_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN') AS distname, COUNT(DISTINCT c.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE c.event_id = p_event_id
      AND (
        norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
        OR
        norm_region IS NULL AND (
          norm_district IS NULL OR
          UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
        )
      )
    GROUP BY COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN')
  ) sub;

  SELECT COALESCE(json_agg(activity), '[]'::JSON) INTO recent_activity
  FROM (
    SELECT
      c.checkin_id, c.event_id, c.delegate_id, c.session_id,
      c.checked_in_at, c.checked_in_by,
      d.first_name || ' ' || d.last_name AS delegate_name,
      COALESCE(d.district, 'Unknown') AS district,
      COALESCE(d.rank, '-') AS rank,
      COALESCE(d.office, '-') AS office
    FROM (
      SELECT DISTINCT ON (delegate_id) *
      FROM checkins
      WHERE event_id = p_event_id
      ORDER BY delegate_id, checked_in_at DESC
    ) c
    JOIN delegates d ON c.delegate_id = d.delegate_id AND d.event_id = p_event_id
    WHERE (
      norm_region IS NOT NULL AND UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) LIKE norm_region || '%'
      OR
      norm_region IS NULL AND (
        norm_district IS NULL OR
        UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district
      )
    )
    ORDER BY c.checked_in_at DESC
    LIMIT 10
  ) activity;

  RETURN json_build_object(
    'totalDelegates', total_delegates,
    'totalCheckIns', total_checkins,
    'totalArrivals', total_arrivals,
    'totalSessionAttendance', total_session_attendance,
    'totalFinancials', total_financials,
    'checkInsByRank', rank_counts,
    'checkInsByDistrict', district_counts,
    'recentActivity', recent_activity
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- ============================================================================
-- SECTION 3k — FINANCIAL GATE: get_report_aggregates (fixes H1-by-RPC)
-- Body = sprint18 (JSON, latest). financials + pledges are returned only to
-- admins / event admins / finance. All other officers get empty arrays.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_report_aggregates(p_event_id UUID, p_session_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  attended_json JSON;
  session_attendance_json JSON;
  financials_json JSON;
  pledges_json JSON;
BEGIN
  SELECT COALESCE(json_agg(d), '[]'::JSON) INTO attended_json
  FROM (
    SELECT d.delegate_id, d.title, d.first_name, d.last_name, d.chapter, d.district,
           d.email, d.phone, d.rank, d.office, d.delegate_type, d.room_number, c.checked_in_at
    FROM delegates d
    JOIN checkins c ON c.delegate_id = d.delegate_id AND c.event_id = d.event_id
    WHERE d.event_id = p_event_id
      AND ((p_session_id IS NULL AND c.session_id IS NULL)
           OR (p_session_id IS NOT NULL AND c.session_id = p_session_id))
    ORDER BY d.chapter, d.last_name, d.first_name
  ) d;

  SELECT COALESCE(json_agg(sa), '[]'::JSON) INTO session_attendance_json
  FROM (
    SELECT session_id, COUNT(*) AS attendance
    FROM checkins
    WHERE event_id = p_event_id AND session_id IS NOT NULL
    GROUP BY session_id
  ) sa;

  -- Financial gate: only admins / event admins / finance may read money data
  IF is_admin_user() OR is_event_admin_user()
     OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)) THEN
    SELECT COALESCE(json_agg(f), '[]'::JSON) INTO financials_json
    FROM (SELECT * FROM financial_entries WHERE event_id = p_event_id ORDER BY created_at) f;

    SELECT COALESCE(json_agg(p), '[]'::JSON) INTO pledges_json
    FROM (SELECT * FROM pledges WHERE event_id = p_event_id ORDER BY created_at) p;
  ELSE
    financials_json := '[]'::JSON;
    pledges_json := '[]'::JSON;
  END IF;

  RETURN json_build_object(
    'attendedDelegates', attended_json,
    'sessionAttendance', session_attendance_json,
    'financials', financials_json,
    'pledges', pledges_json
  );
END;
$func$;

-- ============================================================================
-- SECTION 4 — RLS POLICY FIXES
-- ============================================================================

-- 4a. app_users INSERT: forbid self-elevation to admin (fixes C3)
DROP POLICY IF EXISTS "app_users_insert_own" ON app_users;
CREATE POLICY "app_users_insert_own" ON app_users FOR INSERT TO authenticated
WITH CHECK (
  id = auth.uid()
  AND (role NOT IN ('national_admin','regional_admin','district_admin','admin') OR is_admin_user())
);

-- 4b. financial_entries SELECT: close to all authenticated (fixes H1)
--     Only admins, event admins, and the finance role may read financial data.
DROP POLICY IF EXISTS "financials_select_all" ON financial_entries;
CREATE POLICY "financials_select_all" ON financial_entries FOR SELECT TO authenticated
USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true))
);

-- 4c. pledges SELECT: close to all authenticated (fixes H1)
DROP POLICY IF EXISTS "pledges_select_all" ON pledges;
CREATE POLICY "pledges_select_all" ON pledges FOR SELECT TO authenticated
USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true))
);

-- 4d. deleted_users: enable RLS + scoped policies (fixes H4)
ALTER TABLE deleted_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deleted_users_select_own" ON deleted_users;
DROP POLICY IF EXISTS "deleted_users_admin_all" ON deleted_users;
CREATE POLICY "deleted_users_select_own" ON deleted_users FOR SELECT TO authenticated
USING (id = auth.uid());
CREATE POLICY "deleted_users_admin_all" ON deleted_users FOR ALL TO authenticated
USING (is_admin_user()) WITH CHECK (is_admin_user());

-- 4e. chapters: writes restricted to admins (fixes H5); reads stay open to authenticated
DROP POLICY IF EXISTS "chapters_insert" ON chapters;
DROP POLICY IF EXISTS "chapters_update" ON chapters;
DROP POLICY IF EXISTS "chapters_delete" ON chapters;
CREATE POLICY "chapters_admin_insert" ON chapters FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "chapters_admin_update" ON chapters FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "chapters_admin_delete" ON chapters FOR DELETE TO authenticated USING (is_admin_user());

-- ============================================================================
-- SECTION 5 — VERIFICATION (read-only diagnostics)
-- Run these to confirm the lockdown took effect and to inspect live drift.
-- ============================================================================

-- 5a. Confirm NO function is callable by anon anymore (target: all 'f')
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
ORDER BY anon_exec DESC, p.proname;

-- 5b. Confirm check_login_account is service_role-only
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'check_login_account';

-- 5c. Live-DB hygiene: which tables still have RLS disabled?
--     (Target result: only tables you intentionally expose. 'financials' here
--      is the orphan table — decide between DROP and RLS-enable.)
SELECT schemaname || '.' || tablename AS table_name, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity, tablename;

-- 5d. Inspect the orphan 'financials' table before deciding drop-vs-migrate
SELECT 'public.financials' AS tbl, COUNT(*) AS row_count FROM public.financials
UNION ALL
SELECT 'public.financial_entries' AS tbl, COUNT(*) AS row_count FROM public.financial_entries;

-- 5e. Auth-schema exposure: any GRANT on auth.users / auth.identities?
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'auth'
  AND grantee IN ('anon', 'authenticated', 'public')
ORDER BY table_name, grantee;

-- 5f. Any RLS policies directly on auth tables? (should be none)
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'auth'
ORDER BY tablename;

-- 5g. Check that SHUT Section 1 did not break the auth helper functions used by RLS
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname IN ('is_admin_user','is_event_admin_user','current_user_district')
ORDER BY p.proname;