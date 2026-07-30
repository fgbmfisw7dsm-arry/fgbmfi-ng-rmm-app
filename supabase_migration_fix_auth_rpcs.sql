-- ============================================================
-- FGBMFI Nigeria EMS — Auth RPC Bugfix Migration
-- Fixes: create_app_user (removes instance_id reference)
--        update_auth_user_email (removes removed column references)
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

-- 1. Drop old function signatures to ensure clean replacement
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS update_auth_user_email(UUID, TEXT);

-- 2. create_app_user — Direct auth.users insert, no instance_id.
--    Uses ONLY columns guaranteed across all Supabase Auth schema versions.
--    instance_id was removed in GoTrue v2 (2024+).
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON AS $$
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

  INSERT INTO public.app_users (id, email, role, district, region, is_active)
  VALUES (new_user_id, email, role, district, region, true);

  RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. update_auth_user_email — Only touches email and confirmed_at.
--    All other token/change columns removed from GoTrue v2 schema.
CREATE OR REPLACE FUNCTION update_auth_user_email(user_id UUID, new_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
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
$$;
