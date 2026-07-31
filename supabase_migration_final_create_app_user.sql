-- ============================================================
-- FGBMFI Nigeria EMS — Final Fix: Single RPC User Creation
-- Run this in Supabase SQL Editor.
--
-- Replaces the broken signUp → restore → confirm → insert chain
-- with a single SECURITY DEFINER RPC that runs everything server-side.
-- No admin session hijacking. No DNS email validation. No auto-delete.
-- ============================================================

-- 1. Drop old versions
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);

-- 2. Single RPC: INSERT auth.users + identities + confirm + app_users
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
BEGIN
    new_user_id := gen_random_uuid();

    -- Optional GoTrue v3 columns (is_sso_user, is_anonymous)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = 'is_sso_user' AND is_generated = 'NEVER'
    ) THEN
        extra_cols := ', is_sso_user, is_anonymous';
        extra_vals := ', false, false';
    END IF;

    -- INSERT into auth.users — omit confirmed_at (GENERATED ALWAYS) and
    -- email_confirmed_at (set via UPDATE below to avoid INSERT ordering issues)
    EXECUTE 'INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, created_at, updated_at'
        || extra_cols || ')
        VALUES ($1, $2, crypt($3, gen_salt(''bf'')), $4, NOW(), NOW()'
        || extra_vals || ')'
        USING new_user_id, email, password,
              jsonb_build_object('role', role, 'provider', 'email');

    -- Insert auth.identities (required by GoTrue for sign-in)
    INSERT INTO auth.identities
        (id, user_id, identity_data, provider, provider_id,
         last_sign_in_at, created_at, updated_at)
    VALUES
        (new_user_id, new_user_id,
         jsonb_build_object('sub', new_user_id, 'email', email),
         'email', email, NOW(), NOW(), NOW());

    -- Confirm the user: set email_confirmed_at (GoTrue checks this)
    -- Clear confirmation tokens so GoTrue's generated confirmed_at computes cleanly
    UPDATE auth.users SET
        email_confirmed_at = NOW(),
        confirmation_token = '',
        confirmation_sent_at = NOW(),
        recovery_token = '',
        email_change_token = '',
        email_change = '',
        updated_at = NOW()
    WHERE id = new_user_id;

    -- Create the app profile
    INSERT INTO public.app_users (id, email, role, district, region, is_active)
    VALUES (new_user_id, email, role, district, region, true);

    RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$func$;
