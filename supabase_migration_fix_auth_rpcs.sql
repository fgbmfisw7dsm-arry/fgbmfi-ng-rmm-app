-- ============================================================
-- FGBMFI Nigeria EMS — Complete Auth Fix Migration
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

-- 1. Auto-confirm RPC (handles both GoTrue v2 email_confirmed_at and v3 confirmed_at)
CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$ DECLARE v_found BOOLEAN; BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmed_at') THEN EXECUTE 'UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id; ELSE EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id; END IF; GET DIAGNOSTICS v_found = ROW_COUNT; IF NOT v_found THEN RETURN json_build_object('status', 'error', 'message', 'User not found'); END IF; RETURN json_build_object('status', 'success'); END; $func$;

-- 2. Allow admins to insert app_users rows for other users (was restricted to id=auth.uid() only)
DROP POLICY IF EXISTS "app_users_admin_insert_all" ON public.app_users;
CREATE POLICY "app_users_admin_insert_all" ON public.app_users FOR INSERT TO authenticated WITH CHECK (is_admin_user());

-- 3. Update delete_app_user to also clean up auth.users (was only deleting from app_users)
DROP FUNCTION IF EXISTS delete_app_user(TEXT);
DROP FUNCTION IF EXISTS delete_app_user(UUID);
CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$ DECLARE v_uid UUID; v_email TEXT; BEGIN v_uid := user_id_to_delete::uuid; SELECT email INTO v_email FROM public.app_users WHERE id = v_uid; IF NOT FOUND THEN RETURN json_build_object('error', 'User not found'); END IF; INSERT INTO public.deleted_users (id, email) VALUES (v_uid, v_email) ON CONFLICT (id) DO UPDATE SET deleted_at = NOW(); DELETE FROM public.app_users WHERE id = v_uid; DELETE FROM auth.users WHERE id = v_uid; RETURN json_build_object('status', 'success', 'message', 'Account permanently removed'); EXCEPTION WHEN OTHERS THEN RETURN json_build_object('error', SQLERRM); END; $func$;

-- 4. Clean up any stale auth.users records that were left orphaned by the old delete_app_user
DELETE FROM auth.users WHERE email LIKE '%@fgbmfi.ng' AND id NOT IN (SELECT id FROM public.app_users);
