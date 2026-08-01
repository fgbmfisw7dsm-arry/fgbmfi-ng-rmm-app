-- ============================================================
-- FGBMFI Nigeria EMS — Aggressive Repair for n_reg@fgbmfi.ng
-- Date: 2026-08-01
--
-- USE THIS if supabase_migration_2026_08_fix_auth_row_integrity.sql
-- keeps leaving n_reg@fgbmfi.ng with has_email_identity = false.
--
-- Run STEP 1 first (diagnostic), then STEP 2 (repair), then STEP 3 (verify).
-- ============================================================

-- ===== STEP 1: DIAGNOSTIC =====
SELECT '--- ALL identities for n_reg@fgbmfi.ng ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
JOIN auth.users u ON u.email = 'n_reg@fgbmfi.ng'
WHERE i.user_id = u.id
ORDER BY i.provider, i.provider_id;

SELECT '--- ALL identities with provider_id=n_reg@fgbmfi.ng (across all users) ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
WHERE i.provider = 'email' AND i.provider_id = 'n_reg@fgbmfi.ng'
ORDER BY i.user_id;

SELECT '--- ALL identities with provider_id=n_reg (bare username leftover, across all users) ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
WHERE i.provider = 'email' AND i.provider_id = 'n_reg'
ORDER BY i.user_id;

SELECT '--- ALL non-email identities for this user ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
JOIN auth.users u ON u.email = 'n_reg@fgbmfi.ng'
WHERE i.user_id = u.id AND i.provider <> 'email'
ORDER BY i.provider, i.provider_id;

-- ===== STEP 2: AGGRESSIVE REPAIR =====
-- Run this in a single transaction so a failure rolls back cleanly.
BEGIN;

-- 2a. Delete ALL email identities with provider_id = 'n_reg@fgbmfi.ng'
--     (any user_id — destructive across all users, but necessary)
DELETE FROM auth.identities
WHERE provider = 'email' AND provider_id = 'n_reg@fgbmfi.ng';

-- 2b. Delete ALL email identities with provider_id = 'n_reg' (bare username leftover)
DELETE FROM auth.identities
WHERE provider = 'email' AND provider_id = 'n_reg';

-- 2c. If auth.users.email is bare 'n_reg', normalize it to 'n_reg@fgbmfi.ng'
--     This must happen BEFORE the identity insert so the provider_id matches.
UPDATE auth.users
SET email = 'n_reg@fgbmfi.ng', updated_at = NOW()
WHERE id = (SELECT id FROM auth.users WHERE email IN ('n_reg', 'n_reg@fgbmfi.ng') LIMIT 1)
  AND email <> 'n_reg@fgbmfi.ng';

-- 2d. Sync app_users.email to match (in case it was also bare)
UPDATE public.app_users
SET email = 'n_reg@fgbmfi.ng', updated_at = NOW()
WHERE email = 'n_reg';

-- 2e. Insert a fresh email identity for the user
INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), u.id,
  jsonb_build_object('sub', u.id, 'email', u.email),
  'email', u.email,
  NOW(), NOW(), NOW()
FROM auth.users u
WHERE u.email = 'n_reg@fgbmfi.ng';

COMMIT;

-- ===== STEP 3: VERIFY =====
SELECT '--- AFTER REPAIR ---' AS section;
SELECT id, email, has_email_identity
FROM v_auth_integrity_check
WHERE email LIKE 'n_reg%' OR NOT has_email_identity
ORDER BY email;
