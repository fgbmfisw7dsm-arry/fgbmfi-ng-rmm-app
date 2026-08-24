-- ============================================================
-- SE1 COUNT DIAGNOSTIC — read-only. Run in the Supabase SQL editor.
-- Purpose: find why 'South East 1' shows ~1218 instead of ~1254
-- (the correct count after the parser fix) and expose the rows that
-- ended up under other/mangled district labels.
-- ============================================================

-- 1) Events + total delegate counts (identify the SE1 host event).
SELECT e.event_id, e.name, count(d.delegate_id) AS delegates
FROM events e
LEFT JOIN delegates d ON d.event_id = e.event_id
GROUP BY e.event_id, e.name
ORDER BY delegates DESC;

-- 2) District distribution in the SE1 event (paste the event_id from query 1).
--    Adjust the WHERE to your actual event id, OR run against '75c3f936-...'.
SELECT d.district, count(*) AS cnt
FROM delegates d
WHERE d.event_id = '<PASTE_SE1_EVENT_ID_HERE>'
GROUP BY d.district
ORDER BY cnt DESC;

-- 3) Mangled / miscoded rows in the SE1 event (gender-as-name, country-as-
--    district, district-code-as-chapter, blank names, blank district).
--    These are the legacy comma-splitter artifacts to remove.
SELECT d.district, d.chapter, d.title, d.first_name, d.last_name,
       d.phone, d.email, d.delegate_id
FROM delegates d
WHERE d.event_id = '<PASTE_SE1_EVENT_ID_HERE>'
  AND (
    COALESCE(TRIM(d.first_name), '') = ''
    OR COALESCE(TRIM(d.last_name), '') = ''
    OR UPPER(TRIM(d.first_name)) IN ('MALE', 'FEMALE')
    OR UPPER(TRIM(d.last_name)) IN ('MALE', 'FEMALE')
    OR UPPER(TRIM(d.district)) IN ('NIGERIA', 'GHANA', 'CAMEROON', 'BENIN', 'TOGO', 'NIGER', 'LIBERIA', 'SIERRA LEONE', 'SOUTH AFRICA', 'KENYA', 'USA', 'UK', 'UNITED KINGDOM', 'CANADA', 'UAE', 'CHINA', 'INDIA')
    OR TRIM(d.chapter) ~ '^[A-Z]{2}D?[0-9]+$'
    OR (COALESCE(TRIM(d.district), '') = '' AND COALESCE(TRIM(d.chapter), '') <> '')
  )
ORDER BY d.chapter NULLS FIRST, d.last_name NULLS FIRST;