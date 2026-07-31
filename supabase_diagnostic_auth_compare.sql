-- ============================================================
-- FGBMFI Nigeria EMS — One-Shot Auth Diagnostic
-- Copy the ENTIRE block and run ONCE in Supabase SQL Editor.
-- ============================================================

-- 1. Clean up test accounts from previous attempts
DELETE FROM app_users WHERE email IN ('diag_test@fgbmfi.ng');
DELETE FROM auth.users WHERE email IN ('diag_test@fgbmfi.ng');

-- 2. Create a fresh test user via our RPC
SELECT create_app_user('diag_test@fgbmfi.ng', 'test123', 'admin') AS create_result;

-- 3. Reset password the official GoTrue way (matching legacy user creation path)
SELECT reset_user_password(
  (SELECT id FROM auth.users WHERE email = 'diag_test@fgbmfi.ng')::text,
  'test123'
) AS reset_result;

-- 4. Side-by-side JSON comparison: RPC user vs known-working legacy user
SELECT 'DIAG_TEST (new)' AS account,
       row_to_json(t) AS full_record
FROM auth.users t WHERE email = 'diag_test@fgbmfi.ng'
UNION ALL
SELECT 'n_admin (works)' AS account,
       row_to_json(t) AS full_record
FROM auth.users t WHERE email = 'n_admin@fgbmfi.ng';

-- 5. Show all columns in auth.users table (so I can see what we might be missing)
SELECT column_name, is_nullable, is_generated, column_default
FROM information_schema.columns
WHERE table_schema = 'auth' AND table_name = 'users'
ORDER BY ordinal_position;
