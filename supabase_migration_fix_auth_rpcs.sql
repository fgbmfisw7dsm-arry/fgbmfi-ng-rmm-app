-- ============================================================
-- FGBMFI Nigeria EMS — Complete Auth Fix
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

-- 1. Rewrite create_app_user with dynamic schema detection
--    Handles GoTrue v2 (email_confirmed_at) and v3 (confirmed_at, is_sso_user)
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$ DECLARE new_user_id UUID; confirmed_cols TEXT := ''; confirmed_vals TEXT := ''; extra_cols TEXT := ''; extra_vals TEXT := ''; BEGIN new_user_id := gen_random_uuid(); IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN confirmed_cols := ', email_confirmed_at'; confirmed_vals := ', NOW()'; ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN confirmed_cols := ', confirmed_at'; confirmed_vals := ', NOW()'; END IF; IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_sso_user' AND is_generated = 'NEVER') THEN extra_cols := ', is_sso_user, is_anonymous'; extra_vals := ', false, false'; END IF; EXECUTE 'INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, created_at, updated_at' || confirmed_cols || extra_cols || ') VALUES ($1, $2, crypt($3, gen_salt(''bf'')), $4, NOW(), NOW()' || confirmed_vals || extra_vals || ')' USING new_user_id, email, password, jsonb_build_object('role', role, 'provider', 'email'); INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at) VALUES (new_user_id, new_user_id, jsonb_build_object('sub', new_user_id, 'email', email), 'email', email, NOW(), NOW(), NOW()); INSERT INTO public.app_users (id, email, role, district, region, is_active) VALUES (new_user_id, email, role, district, region, true); RETURN json_build_object('status', 'success', 'id', new_user_id); EXCEPTION WHEN OTHERS THEN RETURN json_build_object('error', SQLERRM); END; $func$;

-- 2. Allow admins to insert app_users rows for any user id
DROP POLICY IF EXISTS "app_users_admin_insert_all" ON public.app_users;
CREATE POLICY "app_users_admin_insert_all" ON public.app_users FOR INSERT TO authenticated WITH CHECK (is_admin_user());

-- 3. Fix delete_app_user to clean up auth.users too
DROP FUNCTION IF EXISTS delete_app_user(TEXT);
DROP FUNCTION IF EXISTS delete_app_user(UUID);
CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$ DECLARE v_uid UUID; v_email TEXT; BEGIN v_uid := user_id_to_delete::uuid; SELECT email INTO v_email FROM public.app_users WHERE id = v_uid; IF NOT FOUND THEN RETURN json_build_object('error', 'User not found'); END IF; INSERT INTO public.deleted_users (id, email) VALUES (v_uid, v_email) ON CONFLICT (id) DO UPDATE SET deleted_at = NOW(); DELETE FROM public.app_users WHERE id = v_uid; DELETE FROM auth.users WHERE id = v_uid; RETURN json_build_object('status', 'success', 'message', 'Account permanently removed'); EXCEPTION WHEN OTHERS THEN RETURN json_build_object('error', SQLERRM); END; $func$;

-- 4. Remove stale auth.users records orphaned by old delete_app_user
DELETE FROM auth.users WHERE email LIKE '%@fgbmfi.ng' AND id NOT IN (SELECT id FROM public.app_users);
