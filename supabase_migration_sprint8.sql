-- Sprint 8: Fix RPCs + Add Region Support + Fix Delete/Remove
-- Run in Supabase SQL Editor after Sprint 7

-- ============================================================
-- 1. Add region column to app_users (for Regional Admin/Registrar)
-- ============================================================
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS region TEXT;

-- ============================================================
-- 2. Fix delete_app_user RPC (explicit ::uuid cast for remove)
-- ============================================================
DROP FUNCTION IF EXISTS delete_app_user(TEXT);
DROP FUNCTION IF EXISTS delete_app_user(UUID);

CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT)
RETURNS JSON AS $$
BEGIN
  DELETE FROM auth.users WHERE auth.users.id = user_id_to_delete::uuid;
  RETURN json_build_object('status', 'success', 'message', 'Account deleted');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. Fix create_app_user RPC (accept region parameter)
-- ============================================================
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_app_user(
  email TEXT,
  password TEXT,
  role TEXT,
  district TEXT DEFAULT NULL,
  region TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  new_user_id UUID;
BEGIN
  INSERT INTO auth.users (email, password, email_confirmed_at, raw_app_meta_data)
  VALUES (email, crypt(password, gen_salt('bf')), NOW(), jsonb_build_object('role', role))
  RETURNING id INTO new_user_id;

  INSERT INTO public.app_users (id, email, role, district, region, is_active)
  VALUES (new_user_id, email, role, district, region, true);

  RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Verify reset_user_password has ::uuid cast
-- ============================================================
DROP FUNCTION IF EXISTS reset_user_password(TEXT, TEXT);
DROP FUNCTION IF EXISTS reset_user_password(UUID, TEXT);

CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE auth.users.id = user_id::uuid;

  RETURN json_build_object('status', 'success', 'message', 'Password updated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
