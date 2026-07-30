-- ============================================================
-- FGBMFI Nigeria EMS — Auth RPC Bugfix Migration
-- Fixes: create_app_user (removes instance_id, adds identities)
--        update_auth_user_email (removed dead column refs)
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS update_auth_user_email(UUID, TEXT);

CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  new_user_id UUID;
BEGIN
  new_user_id := gen_random_uuid();

  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
  VALUES (
    new_user_id,
    email,
    crypt(password, gen_salt('bf')),
    NOW(),
    jsonb_build_object('role', role, 'provider', 'email'),
    NOW(),
    NOW()
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    new_user_id,
    new_user_id,
    jsonb_build_object('sub', new_user_id, 'email', email),
    'email',
    NOW(),
    NOW(),
    NOW()
  );

  INSERT INTO public.app_users (id, email, role, district, region, is_active)
  VALUES (new_user_id, email, role, district, region, true);

  RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

CREATE OR REPLACE FUNCTION update_auth_user_email(user_id UUID, new_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
    UPDATE auth.users SET
        email = new_email,
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        updated_at = NOW()
    WHERE id = user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('status', 'error', 'message', 'User not found');
    END IF;

    RETURN json_build_object('status', 'success');
END;
$func$;
