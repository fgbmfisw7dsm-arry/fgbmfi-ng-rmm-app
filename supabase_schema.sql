-- FGBMFI NIGERIA - REGIONAL EVENTS MANAGEMENT SYSTEM
-- MASTER DATABASE SCHEMA & RPC FUNCTIONS
-- INSTRUCTIONS: Copy this entire block and run it in the Supabase SQL Editor.
-- NOTE: This file is the COMPLETE schema as of Sprint 8 (July 2026).
--       Always run the FULL file on a fresh Supabase project.
--       For existing projects, run individual migration files in order.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CORE TABLES
CREATE TABLE IF NOT EXISTS events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    region TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    event_config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delegates (
    delegate_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    district TEXT NOT NULL,
    chapter TEXT,
    phone TEXT,
    email TEXT,
    rank TEXT DEFAULT 'CP',
    office TEXT DEFAULT 'OTHER',
    room_number TEXT,
    delegate_type TEXT DEFAULT 'Member',
    qr_hash TEXT NOT NULL,
    phone_normalized TEXT,
    title_key TEXT,
    name_first_key TEXT,
    name_last_key TEXT,
    event_id UUID REFERENCES events(event_id) ON DELETE SET NULL,
    external_id TEXT,
    registration_source TEXT DEFAULT 'import' CHECK (registration_source IN ('import', 'manual', 'qr_scan')),
    badge_printed BOOLEAN NOT NULL DEFAULT false,
    badge_printed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---- Delegate identity normalization (Sprint 21 zero-tolerance dedup) ----
-- Canonical identity: (event, title_key, name_first_key, name_last_key, phone_normalized).
-- TITLE is part of the identity -> "Mr A" and "Mrs A" sharing phone+email are distinct.
CREATE OR REPLACE FUNCTION normalize_phone_sql(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT NULLIF(
    CASE
      WHEN NULLIF(TRIM(COALESCE(p_phone, '')), '') IS NULL THEN ''
      ELSE (
        WITH d AS (
          SELECT regexp_replace(regexp_replace(TRIM(COALESCE(p_phone, '')), '[^0-9]', '', 'g'), '^00', '') AS x
        )
        SELECT CASE
          WHEN x LIKE '234%' AND length(x) > 10 THEN '0' || substring(x FROM 4)
          WHEN length(x) = 11 AND x LIKE '0%' THEN x
          WHEN length(x) = 10 AND substring(x, 1, 1) <> '0' THEN '0' || x
          ELSE x
        END FROM d
      )
    END, ''
  );
$fn$;

CREATE OR REPLACE FUNCTION normalize_name_key(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT regexp_replace(regexp_replace(upper(trim(COALESCE(p_text, ''))), '\s+', ' ', 'g'), '[^A-Z0-9 ]', '', 'g');
$fn$;

CREATE OR REPLACE FUNCTION delegates_identity_norm_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.phone_normalized := normalize_phone_sql(NEW.phone);
  NEW.title_key := normalize_name_key(COALESCE(NULLIF(TRIM(NEW.title), ''), 'Mr'));
  NEW.name_first_key := normalize_name_key(NEW.first_name);
  NEW.name_last_key := normalize_name_key(NEW.last_name);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_delegates_identity_norm ON delegates;
CREATE TRIGGER trg_delegates_identity_norm
BEFORE INSERT OR UPDATE OF title, first_name, last_name, phone ON delegates
FOR EACH ROW EXECUTE FUNCTION delegates_identity_norm_trigger();

CREATE TABLE IF NOT EXISTS sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
    checkin_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    delegate_id UUID REFERENCES delegates(delegate_id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
    checked_in_at TIMESTAMPTZ DEFAULT NOW(),
    checked_in_by UUID
);

CREATE TABLE IF NOT EXISTS pledges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    donor_name TEXT NOT NULL,
    district TEXT NOT NULL,
    chapter TEXT,
    phone TEXT,
    email TEXT,
    amount_pledged DECIMAL(15,2) DEFAULT 0,
    amount_redeemed DECIMAL(15,2) DEFAULT 0,
    pledge_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_entries (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
    pledge_id UUID REFERENCES pledges(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    type TEXT NOT NULL,
    payer_name TEXT,
    payment_mode TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'registrar',
    district TEXT,
    region TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT app_users_role_check CHECK (role IN (
      'national_admin','regional_admin','district_admin','executive_admin','admin',
      'national_registrar','regional_registrar','district_registrar','registrar',
      'finance','event_admin'
    ))
);

CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    districts TEXT[] DEFAULT '{}',
    ranks TEXT[] DEFAULT '{}',
    offices TEXT[] DEFAULT '{}',
    regions TEXT[] DEFAULT '{"Lagos", "North West", "South South", "North Central", "South East", "South West"}',
    titles TEXT[] DEFAULT '{"Mr", "Mrs", "Ms", "Chief", "Dr", "Prof", "Engr", "Elder"}',
    delegate_types TEXT[] DEFAULT '{"Member","National Guest","Free Guest","Dependant-Adult","Dependant-Teen","Dependant-Children","International"}',
    audit_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deleted users tombstone table (for audit trail)
CREATE TABLE IF NOT EXISTS deleted_users (
    id UUID PRIMARY KEY,
    email TEXT,
    deleted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ADMINISTRATIVE RPC FUNCTIONS

-- 3a. Drop existing functions to ensure clean signature update
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS delete_app_user(TEXT);
DROP FUNCTION IF EXISTS delete_app_user(UUID);
DROP FUNCTION IF EXISTS reset_user_password(TEXT, TEXT);
DROP FUNCTION IF EXISTS reset_user_password(UUID, TEXT);
DROP FUNCTION IF EXISTS deactivate_app_user(TEXT);
DROP FUNCTION IF EXISTS reactivate_app_user(TEXT);
DROP FUNCTION IF EXISTS deactivate_all_event_users();

-- 3b. Create User Profile & Auth Account (SECURITY DEFINER, single RPC)
-- Inserts into auth.users with full column coverage (aud, role, instance_id),
-- bcrypt cost 10 (GoTrue-compatible), auto-confirms, creates auth.identities
-- and app_users profile — all in one atomic transaction.
-- Bypasses signUp (avoids DNS email validation, session hijacking).
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
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
    -- WARNING: GoTrue (Supabase Auth) requires bcrypt cost >= 10.
    -- NEVER use gen_salt('bf') — it defaults to cost 6, which causes HTTP 500 at login.
    -- The manual salt below produces cost 10. Any rewrite MUST preserve this.
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

-- 3c. Delete User (Sprint 8 — with tombstone tracking)
CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_uid UUID;
  v_email TEXT;
BEGIN
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

-- 3d. Reset Password (Sprint 14 — bcrypt cost 10, never un-confirms)
CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    v_uid   UUID;
    v_found BOOLEAN;
BEGIN
    v_uid := user_id::uuid;
    UPDATE auth.users
    -- WARNING: GoTrue requires bcrypt cost >= 10. NEVER use gen_salt('bf').
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

-- 3e. Deactivate a single user (soft-delete)
CREATE OR REPLACE FUNCTION deactivate_app_user(user_id TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
  UPDATE public.app_users SET is_active = false WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account deactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3f. Reactivate a single user
CREATE OR REPLACE FUNCTION reactivate_app_user(user_id TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
  UPDATE public.app_users SET is_active = true WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account reactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3g. Bulk deactivate all non-admin users
CREATE OR REPLACE FUNCTION deactivate_all_event_users()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_count INT;
BEGIN
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

-- 3h. Get Auth User Role (reads role from auth.users raw_app_meta_data as fallback)
CREATE OR REPLACE FUNCTION get_auth_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = auth.uid();
$func$;

-- 3i. Auto-confirm a user (handles GoTrue v2, v3, and v3+ GENERATED ALWAYS columns)
-- GoTrue checks BOTH email_confirmed_at AND confirmed_at for IsConfirmed()
CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_confirmed BOOLEAN := false;
BEGIN
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

-- 3j. Check Login Account (Sprint 15 — truthful login diagnostics)
-- Runs as SECURITY DEFINER so the login page (no active session) can read auth.users
-- and report the real failure reason: invalid email format, no account, wrong password,
-- unconfirmed, missing identity, or deactivated.
CREATE OR REPLACE FUNCTION check_login_account(p_email TEXT, p_password TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
    v_email          TEXT := lower(trim(p_email));
    v_uid            UUID;
    v_encrypted      TEXT;
    v_is_active      BOOLEAN;
    v_role           TEXT;
    v_confirmed      BOOLEAN := false;
    v_has_identity   BOOLEAN := false;
    v_password_match BOOLEAN;
    v_format_ok      BOOLEAN;
    v_bcrypt_cost    INT;
BEGIN
    v_format_ok := (v_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$');

    IF NOT v_format_ok THEN
        RETURN json_build_object(
            'email_format_valid', false,
            'account_exists', false,
            'password_matches', NULL::boolean,
            'confirmed', NULL::boolean,
            'has_identity', NULL::boolean,
            'is_active', NULL::boolean,
            'role', NULL::text,
            'bcrypt_cost', NULL::int,
            'recommendation', 'The account email is missing an @domain. Contact the administrator to correct the account email (e.g. officer@fgbmfi.ng).'
        );
    END IF;

    SELECT id, encrypted_password INTO v_uid, v_encrypted
    FROM auth.users
    WHERE lower(trim(email)) = v_email
    LIMIT 1;

    IF v_uid IS NULL THEN
        RETURN json_build_object(
            'email_format_valid', true,
            'account_exists', false,
            'password_matches', NULL::boolean,
            'confirmed', NULL::boolean,
            'has_identity', NULL::boolean,
            'is_active', NULL::boolean,
            'role', NULL::text,
            'bcrypt_cost', NULL::int,
            'recommendation', 'No auth.users row exists for this email. The account may never have been created.'
        );
    END IF;

    SELECT is_active, role INTO v_is_active, v_role
    FROM public.app_users WHERE id = v_uid;

    -- Extract bcrypt cost from stored password hash
    IF v_encrypted IS NOT NULL THEN
        BEGIN
            v_bcrypt_cost := substring(v_encrypted FROM '\$2[aby]\$(\d+)')::INT;
        EXCEPTION WHEN OTHERS THEN
            v_bcrypt_cost := NULL;
        END;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'email_confirmed_at') THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1 AND email_confirmed_at IS NOT NULL)'
            INTO v_confirmed USING v_uid;
    END IF;
    IF NOT v_confirmed AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'confirmed_at') THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1 AND confirmed_at IS NOT NULL)'
            INTO v_confirmed USING v_uid;
    END IF;

    SELECT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid AND provider = 'email')
        INTO v_has_identity;

    IF p_password IS NOT NULL AND p_password <> '' THEN
        v_password_match := (crypt(p_password, v_encrypted) = v_encrypted);
    END IF;

    RETURN json_build_object(
        'email_format_valid', v_format_ok,
        'account_exists', true,
        'password_matches', v_password_match,
        'confirmed', v_confirmed,
        'has_identity', v_has_identity,
        'is_active', v_is_active,
        'role', v_role,
        'bcrypt_cost', v_bcrypt_cost,
        'recommendation', CASE
            WHEN v_bcrypt_cost IS NOT NULL AND v_bcrypt_cost < 10
                THEN 'bcrypt cost is ' || v_bcrypt_cost || ' — GoTrue requires >= 10. The account must be re-created or its password reset via admin UI.'
            WHEN NOT v_confirmed THEN 'Account is not confirmed. Re-run the auth integrity fix migration.'
            WHEN NOT v_has_identity THEN 'Account is missing its email identity row. Re-run the auth integrity fix migration.'
            ELSE 'Account exists and appears structurally sound. If login still fails, check GoTrue service health.'
        END
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'error', SQLERRM,
        'detail', SQLSTATE,
        'recommendation', 'Diagnostic check failed. Run the v_auth_integrity_check view in Supabase.'
    );
END;
$func$;

GRANT EXECUTE ON FUNCTION check_login_account(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_login_account(TEXT, TEXT) TO authenticated;

-- 3k. Confirm User By Email (v1.6 — used by signUp-based createUser)
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

GRANT EXECUTE ON FUNCTION confirm_user_by_email(TEXT) TO authenticated;

-- 4. INITIAL SEED DATA
INSERT INTO system_settings (districts, ranks, offices, regions)
SELECT 
    '{"Lagos Central", "Abuja Central", "Rivers", "Kano", "Kaduna", "Enugu", "Edo", "Anambra", "National/External"}',
    '{"CP", "FR", "ND", "CP-REP"}',
    '{"DC", "RVP", "NVP", "NP", "NEC", "BOT", "CP", "FR", "ND", "CP-REP", "OTHER"}',
    '{"Lagos", "North West", "South South", "North Central", "South East", "South West"}'
WHERE NOT EXISTS (SELECT 1 FROM system_settings);

-- 5. INDEXES (Performance — required for 25K scale)

-- GIN trigram indexes for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DROP INDEX IF EXISTS idx_delegates_name_gin;
CREATE INDEX idx_delegates_name_gin 
  ON delegates USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);

-- B-tree indexes
DROP INDEX IF EXISTS idx_delegates_phone;
CREATE INDEX idx_delegates_phone ON delegates(phone);
DROP INDEX IF EXISTS idx_checkins_event_delegate;
CREATE INDEX idx_checkins_event_delegate ON checkins(event_id, delegate_id);
DROP INDEX IF EXISTS idx_checkins_event_session;
CREATE INDEX idx_checkins_event_session ON checkins(event_id, session_id);
DROP INDEX IF EXISTS idx_financials_event;
CREATE INDEX idx_financials_event ON financial_entries(event_id);
DROP INDEX IF EXISTS idx_pledges_event;
CREATE INDEX idx_pledges_event ON pledges(event_id);
CREATE INDEX IF NOT EXISTS idx_delegates_event_id ON delegates(event_id);
CREATE INDEX IF NOT EXISTS idx_delegates_external_id ON delegates(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delegates_badge_printed ON delegates(event_id, badge_printed);

-- Unique indexes
DROP INDEX IF EXISTS idx_delegates_qr_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_qr_hash ON delegates(qr_hash);

-- Zero-tolerance backstop (Sprint 21): one person = one row. Enforced for every
-- identified delegate (phone present). Rows without a phone cannot be reliably
-- identified and are exempted (handled by the merging/email fallback).
-- NOTE for existing databases: create this ONLY after running the Spring 21
-- cleanup migration (supabase_migration_sprint21_dedup_cleanup.sql) has merged
-- current duplicates — creation fails while duplicates exist.
DROP INDEX IF EXISTS idx_delegates_same_person;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_same_person ON delegates(
  event_id,
  title_key,
  name_first_key,
  name_last_key,
  COALESCE(phone_normalized, '')
) WHERE NULLIF(phone_normalized, '') IS NOT NULL;

-- 6. CHAPTERS TABLE (District-linked chapter registry)
CREATE TABLE IF NOT EXISTS chapters (
    chapter_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    district TEXT NOT NULL,
    chapter_code TEXT,
    chapter_name TEXT NOT NULL,
    state TEXT,
    city TEXT,
    meeting_day TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chapters_district ON chapters(district);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_code_unique ON chapters(chapter_code);

ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chapters_select" ON chapters;
CREATE POLICY "chapters_select" ON chapters FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "chapters_insert" ON chapters;
CREATE POLICY "chapters_insert" ON chapters FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "chapters_update" ON chapters;
CREATE POLICY "chapters_update" ON chapters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 7. AGGREGATE RPCs (Dashboard performance)

-- Dashboard stats: returns counts and aggregates for a single event
CREATE OR REPLACE FUNCTION get_event_dashboard_stats(p_event_id UUID, p_district TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  total_delegates BIGINT;
  total_checkins BIGINT;
  total_financials BIGINT;
  rank_counts JSON;
  district_counts JSON;
  recent_activity JSON;
  norm_district TEXT;
BEGIN
  norm_district := CASE WHEN p_district IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g')) ELSE NULL END;

  IF norm_district IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = norm_district;
  ELSE
    SELECT COUNT(*) INTO total_delegates FROM delegates;
  END IF;

  SELECT COUNT(DISTINCT d.delegate_id) INTO total_checkins
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id
  WHERE c.event_id = p_event_id
    AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district);

  SELECT COALESCE(SUM(amount), 0) INTO total_financials
  FROM financial_entries
  WHERE event_id = p_event_id;

  SELECT COALESCE(json_object_agg(rnk, cnt), '{}'::JSON) INTO rank_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER') AS rnk, COUNT(DISTINCT d.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
    GROUP BY COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER')
  ) sub;

  SELECT COALESCE(json_object_agg(distname, cnt), '{}'::JSON) INTO district_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN') AS distname, COUNT(DISTINCT d.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
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
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
    ORDER BY c.checked_in_at DESC
    LIMIT 10
  ) activity;

  RETURN json_build_object(
    'totalDelegates', total_delegates,
    'totalCheckIns', total_checkins,
    'totalArrivals', (SELECT COUNT(DISTINCT delegate_id) FROM checkins WHERE event_id = p_event_id AND session_id IS NULL),
    'totalSessionAttendance', (SELECT COUNT(*) FROM checkins WHERE event_id = p_event_id AND session_id IS NOT NULL),
    'totalFinancials', total_financials,
    'checkInsByRank', rank_counts,
    'checkInsByDistrict', district_counts,
    'recentActivity', recent_activity
  );
END;
$func$;

-- Paginated delegates query (for MasterListModule)
CREATE OR REPLACE FUNCTION get_paginated_delegates(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_district TEXT DEFAULT NULL,
  p_event_id UUID DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  total_count BIGINT;
  results JSON;
  offset_val INTEGER;
BEGIN
  offset_val := (p_page - 1) * p_page_size;

  SELECT COUNT(*) INTO total_count FROM delegates
  WHERE (
    p_search IS NULL OR
    first_name ILIKE '%' || p_search || '%' OR
    last_name ILIKE '%' || p_search || '%' OR
    phone ILIKE '%' || p_search || '%' OR
    email ILIKE '%' || p_search || '%' OR
    chapter ILIKE '%' || p_search || '%'
  )
  AND (
    p_district IS NULL OR
    UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g'))
  )
  AND (
    p_event_id IS NULL OR
    event_id = p_event_id
  );

  SELECT COALESCE(json_agg(delegate_rows), '[]'::JSON) INTO results
  FROM (
    SELECT * FROM delegates
    WHERE (
      p_search IS NULL OR
      first_name ILIKE '%' || p_search || '%' OR
      last_name ILIKE '%' || p_search || '%' OR
      phone ILIKE '%' || p_search || '%' OR
      email ILIKE '%' || p_search || '%' OR
      chapter ILIKE '%' || p_search || '%'
    )
    AND (
      p_district IS NULL OR
      UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g'))
    )
    AND (
      p_event_id IS NULL OR
      event_id = p_event_id
    )
    ORDER BY chapter, last_name, first_name
    LIMIT p_page_size
    OFFSET offset_val
  ) delegate_rows;

  RETURN json_build_object(
    'data', results,
    'total', total_count,
    'page', p_page,
    'pageSize', p_page_size,
    'totalPages', CEIL(total_count::FLOAT / p_page_size)
  );
END;
$func$;

-- Export data RPC (replaces client-side getAllDataForExport)
CREATE OR REPLACE FUNCTION get_event_export_data(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  delegates_json JSON;
  checkins_json JSON;
  financials_json JSON;
  pledges_json JSON;
BEGIN
  SELECT COALESCE(json_agg(d), '[]'::JSON) INTO delegates_json
  FROM (
    SELECT delegate_id, title, first_name, last_name, district, chapter, phone, email, rank, office, room_number, created_at
    FROM delegates
    ORDER BY chapter, last_name, first_name
  ) d;

  SELECT COALESCE(json_agg(c), '[]'::JSON) INTO checkins_json
  FROM (
    SELECT c.*, d.first_name || ' ' || d.last_name AS delegate_name, d.district, d.rank, d.office
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
    ORDER BY c.checked_in_at
  ) c;

  SELECT COALESCE(json_agg(f), '[]'::JSON) INTO financials_json
  FROM (
    SELECT * FROM financial_entries
    WHERE event_id = p_event_id
    ORDER BY created_at
  ) f;

  SELECT COALESCE(json_agg(p), '[]'::JSON) INTO pledges_json
  FROM (
    SELECT * FROM pledges
    WHERE event_id = p_event_id
    ORDER BY created_at
  ) p;

  RETURN json_build_object(
    'delegates', delegates_json,
    'checkins', checkins_json,
    'financials', financials_json,
    'pledges', pledges_json
  );
END;
$func$;

-- Bulk import delegates with per-event dedup merge (insert + gap-fill update)
-- Sprint 21: matches on canonical identity (event, title_key, name_first_key,
-- name_last_key, phone_normalized) with email fallback when phone is blank.
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
  v_phone_norm TEXT;
  v_title_key TEXT;
  v_first_key TEXT;
  v_last_key TEXT;
  v_email_lower TEXT;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    v_phone_norm := normalize_phone_sql(v_item->>'phone');
    v_title_key := normalize_name_key(COALESCE(NULLIF(TRIM(v_item->>'title'), ''), 'Mr'));
    v_first_key := normalize_name_key(v_item->>'first_name');
    v_last_key := normalize_name_key(v_item->>'last_name');
    v_email_lower := LOWER(TRIM(COALESCE(v_item->>'email', '')));

    v_existing_id := NULL;
    IF NULLIF(v_phone_norm, '') IS NOT NULL THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND title_key = v_title_key
        AND name_first_key = v_first_key
        AND name_last_key = v_last_key
        AND NULLIF(phone_normalized, '') IS NOT NULL
        AND phone_normalized = v_phone_norm
      LIMIT 1;
    ELSIF v_email_lower <> '' THEN
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND title_key = v_title_key
        AND name_first_key = v_first_key
        AND name_last_key = v_last_key
        AND NULLIF(email, '') IS NOT NULL
        AND LOWER(TRIM(email)) = v_email_lower
      LIMIT 1;
    ELSE
      -- No phone AND no email: dedupe by exact identity alone. Prevents
      -- repeated imports of contact-less rows multiplying identical records.
      SELECT delegate_id INTO v_existing_id
      FROM delegates
      WHERE event_id = p_event_id
        AND title_key = v_title_key
        AND name_first_key = v_first_key
        AND name_last_key = v_last_key
        AND NULLIF(phone_normalized, '') IS NULL
        AND NULLIF(email, '') IS NULL
      LIMIT 1;
    END IF;

    IF v_existing_id IS NULL THEN
      BEGIN
        INSERT INTO delegates (
          title, first_name, last_name, district, chapter,
          phone, email, rank, office, delegate_type,
          qr_hash, event_id, registration_source, external_id
        ) VALUES (
          COALESCE(TRIM(v_item->>'title'), ''),
          TRIM(v_item->>'first_name'),
          TRIM(v_item->>'last_name'),
          TRIM(v_item->>'district'),
          TRIM(v_item->>'chapter'),
          v_phone_norm,
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
      EXCEPTION WHEN unique_violation THEN
        SELECT delegate_id INTO v_existing_id
        FROM delegates
        WHERE event_id = p_event_id
          AND title_key = v_title_key
          AND name_first_key = v_first_key
          AND name_last_key = v_last_key
          AND COALESCE(phone_normalized, '') = COALESCE(v_phone_norm, '')
        LIMIT 1;
        IF v_existing_id IS NOT NULL THEN
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
            phone = CASE WHEN NULLIF(v_phone_norm, '') IS NOT NULL AND normalize_phone_sql(delegates.phone) = v_phone_norm THEN v_phone_norm ELSE delegates.phone END,
            external_id = CASE WHEN COALESCE(NULLIF(TRIM(delegates.external_id), ''), '') = '' AND COALESCE(NULLIF(TRIM(v_item->>'external_id'), ''), '') <> '' THEN TRIM(v_item->>'external_id') ELSE delegates.external_id END
          WHERE delegate_id = v_existing_id;
          GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
          IF v_rows_affected > 0 THEN v_updated := v_updated + 1; ELSE v_skipped := v_skipped + 1; END IF;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      END;
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
        phone = CASE
          WHEN NULLIF(v_phone_norm, '') IS NOT NULL AND normalize_phone_sql(delegates.phone) = v_phone_norm
            THEN v_phone_norm
          ELSE delegates.phone END,
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
          OR (NULLIF(v_phone_norm, '') IS NOT NULL AND normalize_phone_sql(delegates.phone) = v_phone_norm AND delegates.phone <> v_phone_norm)
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

-- 8. ROW-LEVEL SECURITY (RLS) POLICIES

-- 8a. Helper: Check if current user has admin role
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role IN ('national_admin','regional_admin','district_admin','admin')
      AND (is_active IS NULL OR is_active = true)
  );
$func$;

-- 8b. Helper: Get current user's district (for registrar scoping)
CREATE OR REPLACE FUNCTION current_user_district()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT district FROM app_users
  WHERE id = auth.uid()
    AND (is_active IS NULL OR is_active = true)
  LIMIT 1;
$func$;

-- 8b.1 Helper: Is current user registrar-tier (for Free Guest restriction; v1.38)
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

-- 8c. Enable RLS on all tables
ALTER TABLE events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pledges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings  ENABLE ROW LEVEL SECURITY;

-- 8d. Drop existing policies (preserve chapters)
DO $$ DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public')
  LOOP
    IF r.tablename != 'chapters' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END IF;
  END LOOP;
END $$;

-- 8e. app_users policies
CREATE POLICY "app_users_view_own" ON app_users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "app_users_admin_view_all" ON app_users FOR SELECT TO authenticated USING (is_admin_user());
CREATE POLICY "app_users_insert_own" ON app_users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "app_users_admin_insert_all" ON app_users FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "app_users_admin_update" ON app_users FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "app_users_admin_delete" ON app_users FOR DELETE TO authenticated USING (is_admin_user());

-- 8f. events policies
CREATE POLICY "events_select_all" ON events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_admin_insert" ON events FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "events_admin_update" ON events FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "events_admin_delete" ON events FOR DELETE TO authenticated USING (is_admin_user());

-- 8g. delegates policies
CREATE POLICY "delegates_select_all" ON delegates FOR SELECT TO authenticated USING (true);
CREATE POLICY "delegates_insert_scoped" ON delegates FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL));
CREATE POLICY "delegates_update_scoped" ON delegates FOR UPDATE TO authenticated
    USING (is_admin_user() OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL))
    WITH CHECK (is_admin_user() OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL));
CREATE POLICY "delegates_admin_delete" ON delegates FOR DELETE TO authenticated USING (is_admin_user());

-- 8h. sessions policies
CREATE POLICY "sessions_select_all" ON sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_admin_insert" ON sessions FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "sessions_admin_update" ON sessions FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "sessions_admin_delete" ON sessions FOR DELETE TO authenticated USING (is_admin_user());

-- 8i. checkins policies
CREATE POLICY "checkins_select_all" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "checkins_admin_registrar_insert" ON checkins FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
        AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "checkins_admin_update" ON checkins FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "checkins_admin_delete" ON checkins FOR DELETE TO authenticated USING (is_admin_user());

-- 8j. pledges policies
CREATE POLICY "pledges_select_all" ON pledges FOR SELECT TO authenticated USING (true);
CREATE POLICY "pledges_admin_finance_insert" ON pledges FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "pledges_admin_finance_update" ON pledges FOR UPDATE TO authenticated
    USING (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)))
    WITH CHECK (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "pledges_admin_delete" ON pledges FOR DELETE TO authenticated USING (is_admin_user());

-- 8k. financial_entries policies
CREATE POLICY "financials_select_all" ON financial_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "financials_admin_finance_insert" ON financial_entries FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "financials_admin_finance_update" ON financial_entries FOR UPDATE TO authenticated
    USING (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)))
    WITH CHECK (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "financials_admin_delete" ON financial_entries FOR DELETE TO authenticated USING (is_admin_user());

-- 8l. system_settings policies
CREATE POLICY "settings_select_all" ON system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_admin_insert" ON system_settings FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "settings_admin_update" ON system_settings FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());

-- ============================================================================
-- LIVE RECONCILIATION (2026-08-21) — authoritative state per live_schema_dump.txt
-- ----------------------------------------------------------------------------
-- This appendix converges this file onto the DEPLOYED database. Migrations are
-- the true source of truth; the section above is historical bootstrapping DDL.
--
-- Reconciliation notes:
--  * ORPHANS REMOVED from live: public.financials, public.event_delegate_codes
--    (both had RLS disabled, unreferenced; see hardening pass2a/2c). Drop here
--    too so fresh builds match.
--  * get_event_export_data (JSON variant, lines 831-878 above) DOES NOT EXIST in
--    live. The service layer calls it (supabaseService.ts:1193) inside a
--    try/catch and falls back to paginated fetchAll() — so the app works and is
--    actually scale-safe. Kept below as a guarded convenience RPC, NOT deployed.
--  * RLS/policy drift from the bootstrapping section is corrected below to match
--    the live policy set (incl. Pass-1/2C hardening).
-- ============================================================================

-- 9. Orphan cleanup (idempotent; no-op on live where already dropped)
DROP TABLE IF EXISTS public.financials;
DROP TABLE IF EXISTS public.event_delegate_codes;

-- 10. v_auth_integrity_check grants: service_role only (see hardening 2C F1).
--     View definition is MITM over auth.users; exposing SELECT to anon/
--     authenticated triggers the Supabase 'Exposed Auth Users' warning.
REVOKE ALL ON public.v_auth_integrity_check FROM anon;
REVOKE ALL ON public.v_auth_integrity_check FROM authenticated;
GRANT  SELECT ON public.v_auth_integrity_check TO service_role;

-- 11. chapters: drop legacy open policies, keep select-for-all + admin writes
DROP POLICY IF EXISTS "authenticated_all" ON chapters;
DROP POLICY IF EXISTS "chapters_insert" ON chapters;
DROP POLICY IF EXISTS "chapters_update" ON chapters;
DROP POLICY IF EXISTS "chapters_delete" ON chapters;
CREATE POLICY "chapters_select" ON chapters FOR SELECT TO public USING (true);
CREATE POLICY "chapters_admin_insert" ON chapters FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "chapters_admin_update" ON chapters FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "chapters_admin_delete" ON chapters FOR DELETE TO authenticated USING (is_admin_user());

-- 12. policy reconciliation to live set + Pass-1 hardening
-- 12a. app_users: keep select (own/admin), update/delete admin, self-insert
--      restricted to NON-admin roles unless caller is an admin (hardening C3).
DROP POLICY IF EXISTS "app_users_admin_delete" ON app_users;
DROP POLICY IF EXISTS "app_users_admin_insert_all" ON app_users;
DROP POLICY IF EXISTS "app_users_admin_update" ON app_users;
DROP POLICY IF EXISTS "app_users_admin_view_all" ON app_users;
DROP POLICY IF EXISTS "app_users_insert_own" ON app_users;
DROP POLICY IF EXISTS "app_users_view_own" ON app_users;
CREATE POLICY "app_users_admin_delete" ON app_users FOR DELETE TO authenticated USING (is_admin_user());
CREATE POLICY "app_users_admin_insert_all" ON app_users FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "app_users_admin_update" ON app_users FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "app_users_admin_view_all" ON app_users FOR SELECT TO authenticated USING (is_admin_user());
CREATE POLICY "app_users_insert_own" ON app_users FOR INSERT TO authenticated WITH CHECK (
  id = auth.uid() AND (role NOT IN ('national_admin','regional_admin','district_admin','executive_admin','admin') OR is_admin_user()));
CREATE POLICY "app_users_view_own" ON app_users FOR SELECT TO authenticated USING (id = auth.uid());

-- 12b. checkins: registrars + event_admin + admin may insert arrivals/session
DROP POLICY IF EXISTS "checkins_select_all" ON checkins;
DROP POLICY IF EXISTS "checkins_admin_registrar_insert" ON checkins;
DROP POLICY IF EXISTS "checkins_admin_update" ON checkins;
DROP POLICY IF EXISTS "checkins_admin_delete" ON checkins;
CREATE POLICY "checkins_select_all" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "checkins_admin_registrar_insert" ON checkins FOR INSERT TO authenticated WITH CHECK (
     is_admin_user() OR is_event_admin_user() OR EXISTS (
       SELECT 1 FROM app_users
       WHERE id = auth.uid()
         AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
         AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "checkins_admin_update" ON checkins FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "checkins_admin_delete" ON checkins FOR DELETE TO authenticated USING (is_admin_user());

-- 12c. financial_entries + pledges: SELECT scoped to admin/event_admin/finance
--      (hardening H1 / 2C F?); deletes admin-only (hardening pass1 section 4).
DROP POLICY IF EXISTS "financials_select_all" ON financial_entries;
DROP POLICY IF EXISTS "financials_admin_finance_insert" ON financial_entries;
DROP POLICY IF EXISTS "financials_admin_finance_update" ON financial_entries;
DROP POLICY IF EXISTS "financials_admin_delete" ON financial_entries;
CREATE POLICY "financials_select_all" ON financial_entries FOR SELECT TO authenticated USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance','executive_admin') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "financials_admin_finance_insert" ON financial_entries FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "financials_admin_finance_update" ON financial_entries FOR UPDATE TO authenticated
  USING (is_admin_user() OR is_event_admin_user()
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)))
  WITH CHECK (is_admin_user() OR is_event_admin_user()
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "financials_admin_delete" ON financial_entries FOR DELETE TO authenticated USING (is_admin_user());

DROP POLICY IF EXISTS "pledges_select_all" ON pledges;
DROP POLICY IF EXISTS "pledges_admin_finance_insert" ON pledges;
DROP POLICY IF EXISTS "pledges_admin_finance_update" ON pledges;
DROP POLICY IF EXISTS "pledges_admin_delete" ON pledges;
CREATE POLICY "pledges_select_all" ON pledges FOR SELECT TO authenticated USING (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance','executive_admin') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "pledges_admin_finance_insert" ON pledges FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "pledges_admin_finance_update" ON pledges FOR UPDATE TO authenticated
  USING (is_admin_user() OR is_event_admin_user()
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)))
  WITH CHECK (is_admin_user() OR is_event_admin_user()
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'finance' AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "pledges_admin_delete" ON pledges FOR DELETE TO authenticated USING (is_admin_user());

-- 12d. badge_batches: write restricted to admin + event_admin (hardening 2C F8)
DROP POLICY IF EXISTS "Admin can delete badge batches" ON badge_batches;
DROP POLICY IF EXISTS "Admin can insert badge batches" ON badge_batches;
DROP POLICY IF EXISTS "Admin can update badge batches" ON badge_batches;
DROP POLICY IF EXISTS "Authenticated can view badge batches" ON badge_batches;
CREATE POLICY "Authenticated can view badge batches" ON badge_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can insert badge batches" ON badge_batches FOR INSERT TO authenticated WITH CHECK (is_admin_user() OR is_event_admin_user());
CREATE POLICY "Admin can update badge batches" ON badge_batches FOR UPDATE TO authenticated
  USING (is_admin_user() OR is_event_admin_user()) WITH CHECK (is_admin_user() OR is_event_admin_user());
CREATE POLICY "Admin can delete badge batches" ON badge_batches FOR DELETE TO authenticated USING (is_admin_user());

-- 12e. session_response_summaries + session_voice_distribution: update scoped to
--      officers (admin/event_admin/registrar) — hardening 2C F3.
DROP POLICY IF EXISTS "srs_select" ON session_response_summaries;
DROP POLICY IF EXISTS "srs_insert" ON session_response_summaries;
DROP POLICY IF EXISTS "srs_update" ON session_response_summaries;
DROP POLICY IF EXISTS "srs_delete" ON session_response_summaries;
CREATE POLICY "srs_select" ON session_response_summaries FOR SELECT TO authenticated USING (true);
CREATE POLICY "srs_insert" ON session_response_summaries FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
             AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "srs_update" ON session_response_summaries FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
             AND (is_active IS NULL OR is_active = true)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
             AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "srs_delete" ON session_response_summaries FOR DELETE TO authenticated USING (is_admin_user());

DROP POLICY IF EXISTS "svd_select" ON session_voice_distribution;
DROP POLICY IF EXISTS "svd_insert" ON session_voice_distribution;
DROP POLICY IF EXISTS "svd_update" ON session_voice_distribution;
DROP POLICY IF EXISTS "svd_delete" ON session_voice_distribution;
CREATE POLICY "svd_select" ON session_voice_distribution FOR SELECT TO authenticated USING (true);
CREATE POLICY "svd_insert" ON session_voice_distribution FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
             AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "svd_update" ON session_voice_distribution FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
             AND (is_active IS NULL OR is_active = true)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
             AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "svd_delete" ON session_voice_distribution FOR DELETE TO authenticated USING (is_admin_user());

-- 12f. session_responses: delete admin-only; insert scoped to officers (unchanged from live)
DROP POLICY IF EXISTS "sr_select" ON session_responses;
DROP POLICY IF EXISTS "sr_insert" ON session_responses;
DROP POLICY IF EXISTS "sr_delete" ON session_responses;
CREATE POLICY "sr_select" ON session_responses FOR SELECT TO authenticated USING (true);
CREATE POLICY "sr_insert" ON session_responses FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin')
             AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "sr_delete" ON session_responses FOR DELETE TO authenticated USING (is_admin_user());

-- 12g. delegates: keep admin/event_admin unscoped writes + registrar district scope
DROP POLICY IF EXISTS "delegates_select_all" ON delegates;
DROP POLICY IF EXISTS "delegates_insert_scoped" ON delegates;
DROP POLICY IF EXISTS "delegates_update_scoped" ON delegates;
DROP POLICY IF EXISTS "delegates_admin_delete" ON delegates;
CREATE POLICY "delegates_select_all" ON delegates FOR SELECT TO authenticated USING (true);
-- v1.39: restricted events (event_config.restrict_registrar_to_free_guest) allow registrar MANUAL
-- inserts ONLY as 'Free Guest' + district='National/External'; district-scoped manual inserts are
-- disabled on restricted events. QR-scan/import sources remain under normal district scoping.
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
  ));
CREATE POLICY "delegates_update_scoped" ON delegates FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR ((district ~~* COALESCE(current_user_district(), ''::text)) AND (current_user_district() IS NOT NULL)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR ((district ~~* COALESCE(current_user_district(), ''::text)) AND (current_user_district() IS NOT NULL)));
CREATE POLICY "delegates_admin_delete" ON delegates FOR DELETE TO authenticated USING (is_admin_user());

-- 12h. deleted_users: RLS enabled; select own + admin all (hardening H4)
ALTER TABLE deleted_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deleted_users_select_own" ON deleted_users;
DROP POLICY IF EXISTS "deleted_users_admin_all" ON deleted_users;
CREATE POLICY "deleted_users_select_own" ON deleted_users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "deleted_users_admin_all" ON deleted_users FOR ALL TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());

-- 13. FUNCTION GRANT LOCKDOWN (mirrors live + hardening pass1)
--     Revoke EXECUTE on ALL public functions from anon/PUBLIC/authenticated,
--     then re-grant to the roles the application uses. check_login_account is
--     additionally restricted to service_role only (hardening H2).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.oid::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.oid::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.oid::regprocedure);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.check_login_account(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.check_login_account(TEXT, TEXT) TO service_role;

-- 14. SEQUENCES (live)
--     public.audit_log_id_seq (bigint, start=1, inc=1) — owned by audit_log.id