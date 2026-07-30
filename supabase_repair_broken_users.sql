-- ============================================================
-- FGBMFI Nigeria EMS — Repair Existing Broken Users
-- 
-- Fixes users whose auth.users.email was left as a fabricated
-- value (e.g. "okey_admin@fgbmfi.ng") after createUser() due
-- to the update_auth_user_email RPC silently failing.
--
-- Run this AFTER running supabase_migration_fix_auth_rpcs.sql
-- ============================================================

-- Fix users where auth.users.email does not match app_users.email
-- and the app_users email is a non-email username (no @ sign)
UPDATE auth.users u
SET 
    email = a.email,
    email_confirmed_at = COALESCE(u.email_confirmed_at, NOW()),
    updated_at = NOW()
FROM app_users a
WHERE u.id = a.id
  AND u.email != a.email
  AND a.email NOT LIKE '%@%';

-- Report how many users were fixed
SELECT 
    CONCAT('Fixed ', COUNT(*), ' user(s) with mismatched auth email') AS result
FROM auth.users u
JOIN app_users a ON u.id = a.id
WHERE u.email = a.email
  AND a.email NOT LIKE '%@%'
  AND u.email_confirmed_at IS NOT NULL;
