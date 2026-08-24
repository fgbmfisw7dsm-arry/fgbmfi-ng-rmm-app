-- ============================================================
-- SE2 POST-IMPORT VERIFICATION — confirm the 293 and find true dupes.
-- Read-only down to the optional DELETE at the end.
-- ============================================================

-- 1) The full SE2 delegate list (district = South East 2) with identity keys.
--    293 rows expected = 292 (canonical import) + 1 pre-existing (UCHE EDUM).
SELECT d.title, d.first_name, d.last_name, d.chapter, d.phone,
       d.phone_normalized, d.title_key, d.name_first_key, d.name_last_key,
       d.registration_source, d.created_at
FROM delegates d
WHERE d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
  AND UPPER(TRIM(d.district)) IN ('SOUTH EAST 2')
ORDER BY d.last_name, d.first_name;

-- 2) TRUE duplicates: same (title_key, name_first_key, name_last_key, phone_normalized)
--    within South East 2. This is the dedup identity (Sprint 21).
--    Should return NOTHING if the import was clean.
SELECT d.title_key, d.name_first_key, d.name_last_key, d.phone_normalized,
       count(*) AS cnt, array_agg(d.first_name || ' ' || d.last_name ORDER BY d.created_at) AS names
FROM delegates d
WHERE d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
  AND UPPER(TRIM(d.district)) IN ('SOUTH EAST 2')
GROUP BY d.title_key, d.name_first_key, d.name_last_key, d.phone_normalized
HAVING count(*) > 1
ORDER BY cnt DESC;

-- 3) Spouse-style duplicates: same last_name_key + phone but different title
--    (Mr/Mrs sharing a phone). This is EXPECTED (title is part of identity) —
--    flag any that look like the SAME person.
SELECT d.title, d.first_name, d.last_name, d.phone
FROM delegates d
WHERE d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
  AND UPPER(TRIM(d.district)) IN ('SOUTH EAST 2')
  AND d.phone_normalized IN (
    SELECT phone_normalized
    FROM delegates
    WHERE event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
      AND UPPER(TRIM(district)) IN ('SOUTH EAST 2')
      AND phone_normalized IS NOT NULL
    GROUP BY phone_normalized HAVING count(*) > 1
  )
ORDER BY d.phone, d.last_name;

-- 4) The stray junk row (Mark Idenyi — no phone, blank district/chapter).
--    Review, then delete if it's genuinely junk (uncomment the DELETE).
SELECT d.delegate_id, d.district, d.chapter, d.title, d.first_name, d.last_name, d.phone, d.registration_source
FROM delegates d
WHERE d.first_name ILIKE 'mark' AND d.last_name ILIKE 'idenyi'
   OR (d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
       AND COALESCE(TRIM(d.district), '') = ''
       AND COALESCE(TRIM(d.chapter), '') = ''
       AND COALESCE(TRIM(d.phone), '') = '');

-- 5) [OPTIONAL] Delete the stray junk row once confirmed:
-- BEGIN;
-- DELETE FROM delegates
-- WHERE first_name ILIKE 'mark' AND last_name ILIKE 'idenyi'
--   AND COALESCE(TRIM(phone), '') = '';
-- COMMIT;
-- ============================================================
