-- Sprint 8: Fix RPCs + Add Region Support + Fix Delete/Remove
-- Run in Supabase SQL Editor after Sprint 7
-- IMPORTANT: Run each numbered block separately by selecting it and executing

-- ============================================================
-- BLOCK 1: Table changes (select these 3 statements and run)
-- ============================================================
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS region TEXT;

DROP TABLE IF EXISTS deleted_users;
CREATE TABLE deleted_users (
    id UUID PRIMARY KEY,
    email TEXT,
    deleted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN (
  'national_admin','regional_admin','district_admin','admin',
  'national_registrar','regional_registrar','district_registrar','registrar',
  'finance'
));

-- ============================================================
-- BLOCK 2: delete_app_user (select everything from DROP through $$ LANGUAGE and run)
-- ============================================================
DROP FUNCTION IF EXISTS delete_app_user(TEXT);
DROP FUNCTION IF EXISTS delete_app_user(UUID);

CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT)
RETURNS JSON AS $$
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
  RETURN json_build_object('status', 'success', 'message', 'Account permanently removed');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- BLOCK 3: create_app_user (select everything from DROP through $$ LANGUAGE and run)
-- ============================================================
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  new_user_id UUID;
BEGIN
  new_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    is_sso_user, is_anonymous
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    email,
    crypt(password, gen_salt('bf')),
    NOW(),
    jsonb_build_object('role', role),
    '{}'::jsonb,
    NOW(),
    NOW(),
    false,
    false
  );
  INSERT INTO public.app_users (id, email, role, district, region, is_active)
  VALUES (new_user_id, email, role, district, region, true);
  RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- BLOCK 4: reset_user_password (select everything from DROP through $$ LANGUAGE and run)
-- ============================================================
DROP FUNCTION IF EXISTS reset_user_password(TEXT, TEXT);
DROP FUNCTION IF EXISTS reset_user_password(UUID, TEXT);

CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON AS $$
BEGIN
  UPDATE auth.users SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE auth.users.id = user_id::uuid;
  RETURN json_build_object('status', 'success', 'message', 'Password updated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
