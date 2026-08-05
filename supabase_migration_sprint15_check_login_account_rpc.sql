-- FGBMFI Nigeria EMS — Sprint 15: check_login_account RPC
-- Purpose: Truthful login diagnostics. diagnoseLoginFailure() previously called
--          get_my_profile() which requires an active session (auth.uid()), so after a
--          failed login it ALWAYS reported "Account not found". This RPC runs as
--          SECURITY DEFINER and reads auth.users WITHOUT a session, so the login page
--          can report the real reason: invalid email format, no account, wrong password,
--          unconfirmed, missing identity, or deactivated.
--
-- Deploy: Run in Supabase SQL Editor. Requires pgcrypto (crypt).

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
            'recommendation', 'No auth.users row exists for this email. The account may never have been created.'
        );
    END IF;

    SELECT is_active, role INTO v_is_active, v_role
    FROM public.app_users WHERE id = v_uid;

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
        'recommendation', 'Account exists. If login still fails, re-run the auth integrity fix migration and verify via the v_auth_integrity_check view.'
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
