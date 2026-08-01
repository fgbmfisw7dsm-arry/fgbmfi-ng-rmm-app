-- ============================================================
-- FGBMFI Nigeria EMS — Verify test_reg and any other users
-- Date: 2026-08-01
-- ============================================================

-- Full integrity check for ALL users
SELECT id, email, has_aud, has_instance_id, has_role, is_confirmed, has_password, has_email_identity
FROM v_auth_integrity_check
ORDER BY (CASE WHEN NOT has_aud OR NOT has_instance_id OR NOT has_role OR NOT is_confirmed OR NOT has_password OR NOT has_email_identity THEN 0 ELSE 1 END), email;

-- Specifically check test_reg
SELECT '--- test_reg integrity ---' AS section;
SELECT id, email, has_aud, has_instance_id, has_role, is_confirmed, has_password, has_email_identity
FROM v_auth_integrity_check
WHERE email = 'test_reg@fgbmfi.ng' OR email = 'test_reg';

-- Show app_users for test_reg
SELECT '--- test_reg app_users row ---' AS section;
SELECT id, email, role, district, region, is_active, created_at
FROM public.app_users
WHERE email = 'test_reg@fgbmfi.ng' OR email = 'test_reg';

-- Show auth.identities for test_reg's user_id
SELECT '--- test_reg auth.identities ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
JOIN auth.users u ON u.id = i.user_id
WHERE u.email = 'test_reg@fgbmfi.ng' OR u.email = 'test_reg'
ORDER BY i.provider, i.provider_id;

-- Counts
SELECT '--- Summary ---' AS section;
SELECT
  'Total users' AS metric, COUNT(*)::TEXT AS value
FROM auth.users
UNION ALL
SELECT 'Login-ready users',
  COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE has_aud AND has_instance_id AND has_role AND is_confirmed
  AND has_password AND has_email_identity
UNION ALL
SELECT 'Broken users',
  COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE NOT (has_aud AND has_instance_id AND has_role AND is_confirmed
           AND has_password AND has_email_identity);
