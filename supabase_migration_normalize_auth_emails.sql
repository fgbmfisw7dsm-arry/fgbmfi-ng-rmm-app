-- ============================================================
-- FGBMFI Nigeria EMS — Normalize All User Emails
-- Run this ONCE in the Supabase SQL Editor.
-- Ensures auth.users.email = app_users.email = username@fgbmfi.ng
-- for ALL users, matching the current auth code path.
-- ============================================================

-- Step 1: Fix legacy users where app_users.email has no @
--         (e.g., "r_admin" stored directly)
--         These were created by the old signUp + update_auth_user_email flow.
UPDATE app_users
SET email = email || '@fgbmfi.ng'
WHERE email NOT LIKE '%@%';

-- Step 2: Sync auth.users.email to match app_users.email
--         (covers both legacy users fixed in Step 1 and any other mismatches)
UPDATE auth.users
SET
    email = a.email,
    email_confirmed_at = COALESCE(auth.users.email_confirmed_at, NOW()),
    updated_at = NOW()
FROM app_users a
WHERE auth.users.id = a.id
  AND auth.users.email != a.email;

-- Step 3: Ensure email_confirmed_at is set for all users
--         (required by GoTrue; missing timestamp may block login)
DO $$
DECLARE
    v_confirmed_col TEXT;
    v_expr TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = 'confirmed_at' AND is_generated = 'NEVER'
    ) THEN
        v_confirmed_col := 'confirmed_at';
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'users'
          AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER'
    ) THEN
        v_confirmed_col := 'email_confirmed_at';
    END IF;

    IF v_confirmed_col IS NOT NULL THEN
        v_expr := 'UPDATE auth.users SET ' || v_confirmed_col || ' = NOW() WHERE ' || v_confirmed_col || ' IS NULL';
        EXECUTE v_expr;
    END IF;
END $$;

-- Step 4: Report
SELECT
    'Normalization complete' AS status,
    COUNT(*) AS total_app_users,
    COUNT(*) FILTER (WHERE email LIKE '%@fgbmfi.ng') AS with_fgbmfi_suffix,
    COUNT(*) FILTER (WHERE email NOT LIKE '%@fgbmfi.ng') AS other_emails
FROM app_users;
