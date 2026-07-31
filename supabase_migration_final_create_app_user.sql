-- ============================================================
-- FGBMFI Nigeria EMS — Final Fix: Single RPC User Creation (v2)
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1. Drop old versions
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);

-- 2. Single RPC — dynamically builds UPDATE to skip missing columns
CREATE OR REPLACE FUNCTION create_app_user(
    email TEXT, password TEXT, role TEXT,
    district TEXT DEFAULT NULL, region TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    new_user_id UUID;
    extra_cols TEXT := '';
    extra_vals TEXT := '';
    upd_cols TEXT := '';
BEGIN
    new_user_id := gen_random_uuid();

    -- Optional GoTrue v3 columns
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = 'is_sso_user' AND is_generated = 'NEVER'
    ) THEN
        extra_cols := ', is_sso_user, is_anonymous';
        extra_vals := ', false, false';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = 'role' AND is_generated = 'NEVER'
    ) THEN
        extra_cols := extra_cols || ', role';
        extra_vals := extra_vals || ', ''authenticated''';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = 'aud' AND is_generated = 'NEVER'
    ) THEN
        extra_cols := extra_cols || ', aud';
        extra_vals := extra_vals || ', ''authenticated''';
    END IF;

    -- INSERT into auth.users (omit generated columns)
    EXECUTE 'INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, created_at, updated_at'
        || extra_cols || ')
        VALUES ($1, $2, crypt($3, gen_salt(''bf'')), $4, NOW(), NOW()'
        || extra_vals || ')'
        USING new_user_id, email, password,
              jsonb_build_object('role', role, 'provider', 'email');

    -- Insert auth.identities
    INSERT INTO auth.identities
        (id, user_id, identity_data, provider, provider_id,
         last_sign_in_at, created_at, updated_at)
    VALUES
        (new_user_id, new_user_id,
         jsonb_build_object('sub', new_user_id, 'email', email),
         'email', email, NOW(), NOW(), NOW());

    -- Confirm the user: set email_confirmed_at (verified writable on this instance)
    -- Clear tokens where columns exist — skip those that don't
    upd_cols := 'email_confirmed_at = NOW()';

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_token') THEN
        upd_cols := upd_cols || ', confirmation_token = ''''';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_sent_at') THEN
        upd_cols := upd_cols || ', confirmation_sent_at = NOW()';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'recovery_token') THEN
        upd_cols := upd_cols || ', recovery_token = ''''';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token_current') THEN
        upd_cols := upd_cols || ', email_change_token_current = ''''';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token_new') THEN
        upd_cols := upd_cols || ', email_change_token_new = ''''';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change') THEN
        upd_cols := upd_cols || ', email_change = ''''';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_sent_at') THEN
        upd_cols := upd_cols || ', email_change_sent_at = NOW()';
    END IF;

    EXECUTE 'UPDATE auth.users SET ' || upd_cols || ', updated_at = NOW() WHERE id = $1' USING new_user_id;

    -- Create the app profile
    INSERT INTO public.app_users (id, email, role, district, region, is_active)
    VALUES (new_user_id, email, role, district, region, true);

    RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$func$;
