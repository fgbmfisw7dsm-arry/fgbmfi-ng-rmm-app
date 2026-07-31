-- ============================================================
-- FGBMFI Nigeria EMS — Fix create_app_user for GoTrue v3+
-- Run this ENTIRE block in the Supabase SQL Editor.
-- Fixes: "cannot insert a non-DEFAULT value into column confirmed_at"
-- ============================================================

-- 1. Drop all old signatures
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);

-- 2. Rewritten RPC: never INSERT into generated columns
--    Sets confirmation timestamp via UPDATE after INSERT with EXCEPTION handler.
--    This handles GoTrue v2 (email_confirmed_at), v3 (confirmed_at),
--    and v3+ where confirmed_at may be GENERATED ALWAYS (unsettable).
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
    confirm_ok BOOLEAN := false;
BEGIN
    new_user_id := gen_random_uuid();

    -- Handle optional GoTrue v3 columns (is_sso_user, is_anonymous)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = 'is_sso_user' AND is_generated = 'NEVER'
    ) THEN
        extra_cols := ', is_sso_user, is_anonymous';
        extra_vals := ', false, false';
    END IF;

    -- INSERT into auth.users — intentionally omit email_confirmed_at and confirmed_at
    -- (these may be GENERATED ALWAYS in newer GoTrue versions and reject explicit values)
    EXECUTE 'INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, created_at, updated_at'
        || extra_cols || ')
        VALUES ($1, $2, crypt($3, gen_salt(''bf'')), $4, NOW(), NOW()'
        || extra_vals || ')'
        USING new_user_id, email, password,
              jsonb_build_object('role', role, 'provider', 'email');

    -- Insert identity (required by GoTrue for sign-in)
    INSERT INTO auth.identities
        (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES
        (new_user_id, new_user_id,
         jsonb_build_object('sub', new_user_id, 'email', email),
         'email', email, NOW(), NOW(), NOW());

    -- Auto-confirm the user. Use a separate UPDATE (not INSERT) to avoid
    -- the "cannot insert a non-DEFAULT value into column" error on
    -- GENERATED ALWAYS columns (GoTrue v3+).
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'auth' AND table_name = 'users'
              AND column_name = 'confirmed_at' AND is_generated = 'NEVER'
        ) THEN
            UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW()
            WHERE id = new_user_id;
            confirm_ok := true;
        ELSIF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'auth' AND table_name = 'users'
              AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER'
        ) THEN
            UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW()
            WHERE id = new_user_id;
            confirm_ok := true;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Column is GENERATED ALWAYS and not updatable either.
        -- GoTrue should auto-confirm since confirmation_token is empty.
        confirm_ok := false;
    END;

    -- If any confirmation column exists but didn't match 'NEVER' (e.g. 'ALWAYS'),
    -- try clearing auth tokens to trigger GoTrue auto-confirmation
    IF NOT confirm_ok THEN
        BEGIN
            UPDATE auth.users SET
                confirmation_token = '',
                recovery_token = '',
                email_change_token = '',
                email_change = '',
                updated_at = NOW()
            WHERE id = new_user_id;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    -- Create the app profile
    INSERT INTO public.app_users (id, email, role, district, region, is_active)
    VALUES (new_user_id, email, role, district, region, true);

    RETURN json_build_object('status', 'success', 'id', new_user_id, 'confirmed', confirm_ok);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$func$;
