-- ============================================================
-- FGBMFI Nigeria EMS — Quick Auth State Summary
-- Date: 2026-08-01
-- Run this in the Supabase SQL Editor.
-- Returns only the critical data needed to diagnose login failures.
-- ============================================================

-- 1. Users in auth.users
SELECT '--- §1: All auth.users ---' AS section;
SELECT id, email,
       (aud = 'authenticated') AS has_aud,
       (instance_id IS NOT NULL) AS has_instance_id,
       (role IS NOT NULL) AS has_role,
       (email_confirmed_at IS NOT NULL) AS is_confirmed,
       (encrypted_password IS NOT NULL) AS has_password
FROM auth.users
ORDER BY email;

-- 2. Duplicate email identities (same provider+provider_id for multiple users)
SELECT '--- §2: Duplicate email identities (the critical one) ---' AS section;
SELECT provider_id, COUNT(*) AS user_count, array_agg(DISTINCT user_id::text) AS user_ids
FROM auth.identities
WHERE provider = 'email'
GROUP BY provider_id
HAVING COUNT(*) > 1
ORDER BY user_count DESC;

-- 3. All identities with their user emails
SELECT '--- §3: All email identities with user emails ---' AS section;
SELECT i.id AS identity_id, i.user_id, u.email AS user_email, i.provider, i.provider_id
FROM auth.identities i
LEFT JOIN auth.users u ON u.id = i.user_id
WHERE i.provider = 'email'
ORDER BY i.provider_id, u.email;

-- 4. Users without an email identity
SELECT '--- §4: Users missing email identity ---' AS section;
SELECT u.id, u.email
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
)
ORDER BY u.email;

-- 5. app_users state for all users
SELECT '--- §5: app_users state ---' AS section;
SELECT a.id, a.email, a.role, a.is_active, a.created_at
FROM public.app_users a
ORDER BY a.email;

-- 6. Users in auth.users but NOT in app_users
SELECT '--- §6: auth.users rows with no app_users row ---' AS section;
SELECT u.id, u.email
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = u.id)
ORDER BY u.email;

-- 7. Try to simulate what get_my_profile returns for each user
-- (this is what signInWithPassword's downstream call uses)
SELECT '--- §7: get_my_profile simulation per user ---' AS section;
SELECT u.id, u.email,
       (SELECT row_to_json(t) FROM public.app_users t WHERE t.id = u.id) AS profile_data
FROM auth.users u
ORDER BY u.email;
