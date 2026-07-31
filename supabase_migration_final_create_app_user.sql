-- ============================================================
-- FGBMFI Nigeria EMS — create_app_user RPC (v3)
-- Run this in Supabase SQL Editor.
-- Sets all required GoTrue columns dynamically.
-- ============================================================

DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_app_user(
    email TEXT, password TEXT, role TEXT,
    district TEXT DEFAULT NULL, region TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    new_user_id UUID;
    v_instance_id UUID;
    ins_cols TEXT;
    ins_vals TEXT;
    upd_cols TEXT;
BEGIN
    new_user_id := gen_random_uuid();

    -- Get project instance_id from any existing user (auth.uid() is NULL in SECURITY DEFINER)
    SELECT instance_id INTO v_instance_id FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1;

    -- Build INSERT column/value lists dynamically
    ins_cols := 'id, email, encrypted_password, created_at, updated_at, raw_app_meta_data, aud, role';
    ins_vals := '$1, $2, crypt($3, gen_salt(''bf'')), NOW(), NOW(), $4, ''authenticated'', ''authenticated''';

    IF v_instance_id IS NOT NULL THEN
        ins_cols := ins_cols || ', instance_id';
        ins_vals := ins_vals || ', $5';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_sso_user' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', is_sso_user, is_anonymous';
        ins_vals := ins_vals || ', false, false';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'raw_user_meta_data' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', raw_user_meta_data';
        ins_vals := ins_vals || ', ''{}''::jsonb';
    END IF;

    IF v_instance_id IS NOT NULL THEN
        EXECUTE 'INSERT INTO auth.users (' || ins_cols || ') VALUES (' || ins_vals || ')'
            USING new_user_id, email, password,
                  jsonb_build_object('role', role, 'provider', 'email'),
                  v_instance_id;
    ELSE
        EXECUTE 'INSERT INTO auth.users (' || ins_cols || ') VALUES (' || ins_vals || ')'
            USING new_user_id, email, password,
                  jsonb_build_object('role', role, 'provider', 'email');
    END IF;

    -- Insert auth.identities
    INSERT INTO auth.identities
        (id, user_id, identity_data, provider, provider_id,
         last_sign_in_at, created_at, updated_at)
    VALUES
        (new_user_id, new_user_id,
         jsonb_build_object('sub', new_user_id, 'email', email),
         'email', email, NOW(), NOW(), NOW());

    -- Confirm the user: set email_confirmed_at + clear tokens
    upd_cols := 'email_confirmed_at = NOW()';

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_token') THEN
        upd_cols := upd_cols || ', confirmation_token = ''''';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_sent_at') THEN
        upd_cols := upd_cols || ', confirmation_sent_at = NOW()';
    END IF;

    EXECUTE 'UPDATE auth.users SET ' || upd_cols || ', updated_at = NOW() WHERE id = $1' USING new_user_id;

    -- Create app profile
    INSERT INTO public.app_users (id, email, role, district, region, is_active)
    VALUES (new_user_id, email, role, district, region, true);

    RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$func$;
