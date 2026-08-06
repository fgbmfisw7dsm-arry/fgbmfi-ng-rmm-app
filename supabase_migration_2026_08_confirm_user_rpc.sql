-- MIGRATION: confirm_user_by_email RPC (2026-08-06)
-- SECURITY DEFINER function to auto-confirm a user created via signUp().
-- Sets email_confirmed_at / confirmed_at and ensures an auth.identities row exists.
-- Used by the rewrite: createUser now calls supabase.auth.signUp() instead of
-- manually INSERTing into auth.users (eliminating schema drift concerns).

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

    -- Confirm via email_confirmed_at
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'email_confirmed_at') THEN
        EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1'
            USING v_uid;
        v_confirmed := true;
    END IF;

    -- Confirm via confirmed_at (fallback for older GoTrue)
    IF NOT v_confirmed AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'confirmed_at') THEN
        EXECUTE 'UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = $1'
            USING v_uid;
        v_confirmed := true;
    END IF;

    -- Fallback: set email_verified in raw_app_meta_data
    IF NOT v_confirmed THEN
        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || '{"email_verified": true}'::jsonb
        WHERE id = v_uid;
        v_confirmed := true;
    END IF;

    -- Ensure email identity row exists (signUp may not create it if unconfirmed)
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
