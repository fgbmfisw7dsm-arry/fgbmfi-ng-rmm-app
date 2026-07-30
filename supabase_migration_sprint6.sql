-- Sprint 6: Account Deactivation & Post-Event Cleanup
-- Run this in Supabase SQL Editor (Project → SQL Editor)
-- Adds soft-deactivation support to app_users for post-event account management

-- 1. Add is_active column to app_users
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 2. Backfill existing users as active
UPDATE app_users SET is_active = true WHERE is_active IS NULL;

-- 3. Drop existing deactivation functions if re-running
DROP FUNCTION IF EXISTS deactivate_app_user(TEXT);
DROP FUNCTION IF EXISTS reactivate_app_user(TEXT);
DROP FUNCTION IF EXISTS deactivate_all_event_users();

-- 4a. Deactivate a single user (soft-delete)
CREATE OR REPLACE FUNCTION deactivate_app_user(user_id TEXT)
RETURNS JSON AS $$
BEGIN
  UPDATE public.app_users SET is_active = false WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account deactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4b. Reactivate a single user
CREATE OR REPLACE FUNCTION reactivate_app_user(user_id TEXT)
RETURNS JSON AS $$
BEGIN
  UPDATE public.app_users SET is_active = true WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account reactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4c. Bulk deactivate all non-admin users (excludes national_admin, regional_admin, district_admin, admin)
CREATE OR REPLACE FUNCTION deactivate_all_event_users()
RETURNS JSON AS $$
DECLARE
  v_count INT;
BEGIN
  WITH updated AS (
    UPDATE public.app_users 
    SET is_active = false 
    WHERE is_active = true 
      AND role NOT IN ('national_admin', 'regional_admin', 'district_admin', 'admin')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  
  RETURN json_build_object(
    'status', 'success',
    'message', 'Bulk deactivation complete',
    'deactivated_count', v_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
