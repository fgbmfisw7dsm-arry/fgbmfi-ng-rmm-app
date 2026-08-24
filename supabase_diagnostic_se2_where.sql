-- ============================================================
-- SE2 "WHERE DID THE ROWS GO" — scans ALL events (read-only).
--
-- Query 2 earlier returned 0 rows for the ENUGU*/EBONYI* zone names inside the
-- Lagos event, yet only ~1 row surfaced under "South East 2". That means the
-- SE2 data either (a) went into a DIFFERENT event, (b) was mostly NOT inserted
-- (import reported ~1), or (c) ended up under other district labels. These
-- queries search every event so we can find the rows no matter where they are.
-- All queries are read-only SELECTs.
-- ============================================================

-- A) Every event + its delegate count (reconnaissance).
SELECT e.event_id, e.name, count(d.delegate_id) AS delegates
FROM events e
LEFT JOIN delegates d ON d.event_id = e.event_id
GROUP BY e.event_id, e.name
ORDER BY delegates DESC;

-- B) Across ALL events: how many rows carry an ENUGU*/EBONYI* ZONE as district
--    (or have a current district = the South East zones). Shows which event
--    actually holds the SE2 rows AND the exact district labels used.
SELECT e.name AS event, d.district, count(*) AS cnt
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE UPPER(TRIM(d.district)) IN (
        'ENUGU METROPOLITAN', 'EBONYI NORTH', 'ENUGU WEST', 'ENUGU NORTH',
        'ENUGU EAST', 'EBONYI SOUTH', 'ENUGU SOUTH', 'EBONYI NORTH ZONE',
        'NSUKKA')
GROUP BY e.name, d.district
ORDER BY cnt DESC;

-- C) Across ALL events: rows whose district is something South-East-2-ish
--    (official spelling variants / aliases), including "South East 2".
SELECT e.name AS event, d.district, count(*) AS cnt
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE UPPER(TRIM(d.district)) IN (
        'SOUTH EAST 2', 'SOUTH EAST TWO', 'SED 2', 'SED2',
        'SOUTH EAST DISTRICT 2', 'ENUGU', 'EBONYI', 'SOUTH-EAST 2')
   OR (COALESCE(TRIM(d.district), '') = '' AND COALESCE(TRIM(d.chapter), '') <> '')
GROUP BY e.name, d.district
ORDER BY cnt DESC;

-- D) Rows that look like they were imported from the SE2 file but under ANY
--    district: blank last name + non-blank first name + a chapter that is one
--    of the SE2 handbook chapters (ENUGU*/ABAKALIKI*/EBONYI* chapters).
SELECT e.name AS event, d.district, d.chapter, count(*) AS cnt
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE COALESCE(TRIM(d.last_name), '') = ''
  AND COALESCE(TRIM(d.first_name), '') <> ''
  AND UPPER(TRIM(COALESCE(d.chapter, ''))) IN (
        'ENUGU MARYLAND', 'ENUGU GRA EMINENT', 'ENUGU XCELLING XTEND',
        'ENUGU GOLDEN', 'ENUGU MUNICIPAL L/H', 'ENUGU EXECUTIVE', 'ENUGU MAIN',
        'NEW HAVEN', 'NIKE LAKE', 'PHASE 6', 'EKULU', 'TRANS-EKULU ESTATE',
        'NSUKKA', 'ABAKALIKI MAIN', 'ABAKALIKI EMINENT', 'ABAKALIKI GATEWAY',
        'ABAKALIKI INLAND', 'ABAKALIKI NTA', 'ABAKALIKI POLICE HQTR',
        'ABAKALIKI CITI CHEF', 'ABAKALIKI EXPRESS', 'ABAKALIKI CRUNCHES',
        'ABAKALIKI NGC XTEND', 'AFIKPO CITY', 'FCIA', 'SPERA-IN-DEO',
        'UBURU MAIN', 'AWKUNANAW', 'SUNSHINE LUNCH HOUR', 'COMM. LAYOUT',
        'ARIA NEW MARKET', 'UGBO-ODOGWU', 'ABAKALIKI FEDERAL ROAD SAFETY(FRSC)',
        'ABAKPA NIKE', 'METROPOLITAN XTENT', 'ENUGU MUNICIPAL')
GROUP BY e.name, d.district, d.chapter
ORDER BY cnt DESC;

-- E) Sample of the SE2-looking rows found by (D) — to eyeball identity.
--    Re-run with event_id filled from (D) to list actual people.
-- SELECT d.delegate_id, d.district, d.chapter, d.title, d.first_name, d.last_name, d.phone
-- FROM delegates d
-- WHERE d.event_id = '<EVENT_ID_FROM_D>'
--   AND COALESCE(TRIM(d.last_name), '') = ''
--   AND COALESCE(TRIM(d.first_name), '') <> ''
-- ORDER BY d.district, d.chapter;
