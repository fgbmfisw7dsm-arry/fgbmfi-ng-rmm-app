-- ============================================================
-- FGBMFI Nigeria EMS — Aggressive Repair for test_reg@fgbmfi.ng
-- Date: 2026-08-01
--
-- New user created via UsersModule. Reported error on login:
--   "Authentication service returned an unexpected response.
--    The user account may be incomplete."
--
-- This script runs a diagnostic + aggressive repair in a single
-- transaction. Run STEP 1 first to see the current state, then
-- STEP 2 to repair, then STEP 3 to verify.
-- ============================================================

-- ===== STEP 1: DIAGNOSTIC =====
SELECT '--- ALL identities for test_reg@fgbmfi.ng ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
JOIN auth.users u ON u.email = 'test_reg@fgbmfi.ng'
WHERE i.user_id = u.id
ORDER BY i.provider, i.provider_id;

SELECT '--- ALL identities with provider_id=test_reg@fgbmfi.ng (across all users) ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
WHERE i.provider = 'email' AND i.provider_id = 'test_reg@fgbmfi.ng'
ORDER BY i.user_id;

SELECT '--- ALL identities with provider_id=test_reg (bare username leftover, across all users) ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
WHERE i.provider = 'email' AND i.provider_id = 'test_reg'
ORDER BY i.user_id;

SELECT '--- ALL non-email identities for this user ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
JOIN auth.users u ON u.email = 'test_reg@fgbmfi.ng'
WHERE i.user_id = u.id AND i.provider <> 'email'
ORDER BY i.provider, i.provider_id;

SELECT '--- app_users row for this user ---' AS section;
SELECT id, email, role, district, region, is_active, created_at
FROM public.app_users
WHERE email = 'test_reg@fgbmfi.ng';

-- ===== STEP 2: AGGRESSIVE REPAIR =====
-- Single transaction: if anything fails, everything rolls back.
BEGIN;

-- 2a. Delete ALL email identities with provider_id = 'test_reg@fgbmfi.ng'
--     (any user_id — destructive across all users, but necessary)
DELETE FROM auth.identities
WHERE provider = 'email' AND provider_id = 'test_reg@fgbmfi.ng';

-- 2b. Delete ALL email identities with provider_id = 'test_reg' (bare username leftover)
DELETE FROM auth.identities
WHERE provider = 'email' AND provider_id = 'test_reg';

-- 2c. Insert a fresh email identity for the user with gen_random_uuid() PK
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
WHERE u.email = 'test_reg@fgbmfi.ng';

-- 2d. If auth.users.email is still bare 'test_reg', update it to 'test_reg@fgbmfi.ng'
--     so the email and identity stay in sync.
UPDATE auth.users
SET email = 'test_reg@fgbmfi.ng', updated_at = NOW()
WHERE email = 'test_reg';

COMMIT;

-- ===== STEP 3: VERIFY =====
SELECT '--- AFTER REPAIR ---' AS section;
SELECT id, email, has_email_identity, has_aud, has_instance_id, has_role, is_confirmed, has_password
FROM v_auth_integrity_check
WHERE email LIKE 'test_reg%' OR NOT has_email_identity
ORDER BY email;
