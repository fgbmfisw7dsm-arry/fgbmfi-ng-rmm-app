-- ============================================================
-- SE1 COUNT DIAGNOSTIC — read-only. Run in the Supabase SQL editor.
-- Purpose: find why 'South East 1' shows ~1218 instead of ~1254
-- (the correct count after the parser fix) and expose the rows that
-- ended up under other/mangled district labels.
--
-- No placeholders needed — every query resolves the SE1 host event
-- automatically from the district / mangled-row signature.
-- ============================================================

-- 1) Events + total delegate counts (identify your SE1 host event).
SELECT e.event_id, e.name, count(d.delegate_id) AS delegates
FROM events e
LEFT JOIN delegates d ON d.event_id = e.event_id
GROUP BY e.event_id, e.name
ORDER BY delegates DESC;

-- 2) District distribution for every event that holds any SE1-signature row
--    (official South East 1, SED 1 / SED1 / SOUTH EAST DISTRICT 1, Anambra,
--    Nigeria, gender-as-name, or district-code-as-chapter).
--    This shows where the ~36 'missing' rows are actually sitting.
WITH se1_sig AS (
  SELECT d.event_id
  FROM delegates d
  WHERE TRIM(d.district) ILIKE 'South East 1'
     OR UPPER(TRIM(d.district)) IN ('SED 1', 'SED1', 'SOUTH EAST DISTRICT 1', 'ANAMBRA', 'NIGERIA', 'S', '1')
     OR UPPER(TRIM(d.first_name)) IN ('MALE', 'FEMALE')
     OR UPPER(TRIM(d.last_name)) IN ('MALE', 'FEMALE')
     OR TRIM(d.chapter) ~ '^[A-Z]{2}D?[0-9]+$'
)
SELECT e.name AS event, d.district, count(*) AS cnt
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE d.event_id IN (SELECT event_id FROM se1_sig)
GROUP BY e.name, d.district
ORDER BY e.name, cnt DESC;

-- 3) The exact mangled / miscoded rows (gender-as-name, country-as-district,
--    district-code-as-chapter, or blank-district-but-has-chapter). Review this
--    list before deleting via DataModule -> Junk Row Cleanup.
SELECT e.name AS event, d.delegate_id, d.district, d.chapter, d.title,
       d.first_name, d.last_name, d.phone, d.email
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE UPPER(TRIM(d.first_name)) IN ('MALE', 'FEMALE')
   OR UPPER(TRIM(d.last_name)) IN ('MALE', 'FEMALE')
   OR UPPER(TRIM(d.district)) IN ('NIGERIA', 'GHANA', 'CAMEROON', 'BENIN', 'TOGO', 'NIGER', 'LIBERIA', 'SIERRA LEONE', 'SOUTH AFRICA', 'KENYA', 'USA', 'UK', 'UNITED KINGDOM', 'CANADA', 'UAE', 'CHINA', 'INDIA', 'ANAMBRA')
   OR TRIM(d.chapter) ~ '^[A-Z]{2}D?[0-9]+$'
   OR (COALESCE(TRIM(d.district), '') = '' AND COALESCE(TRIM(d.chapter), '') <> '')
ORDER BY e.name, d.chapter NULLS FIRST, d.last_name NULLS FIRST;