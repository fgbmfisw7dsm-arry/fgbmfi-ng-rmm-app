-- ============================================================
-- SE1 MANGLED-ROW RECOVERY — manual run in the Supabase SQL editor.
-- ============================================================
-- The DB has 5 rows whose first_name was corrupted to 'MALE'/'FEMALE'
-- (legacy comma-splitter column shift): FEMALE EFOBI, FEMALE IGWEONU,
-- MALE BENJANIN, MALE ELIJAH, MALE CHUKWUMA (district Nigeria / chapter SED1).
--
-- Before deleting or repairing them you must know whether a CORRECT duplicate
-- already exists. Run STEP A: for each mangled row it counts siblings with the
-- same event + surname + a phone set (+ matching chapter where present).
--   siblings > 0  -> the correct person already exists -> DELETE the mangled row
--   siblings = 0  -> no correct copy -> REPAIR first_name (data is partially lost)
-- ============================================================

-- ---------------------------------------------------------------------------
-- STEP A — mangled rows + count of correct siblings-with-phone
-- ---------------------------------------------------------------------------
SELECT d.delegate_id AS mangled_id,
       d.first_name, d.last_name, d.district, d.chapter, d.phone,
       (SELECT count(*)
        FROM delegates s
        WHERE s.event_id = d.event_id
          AND s.delegate_id <> d.delegate_id
          AND UPPER(TRIM(s.last_name)) = UPPER(TRIM(d.last_name))
          AND COALESCE(TRIM(s.phone), '') <> ''
          AND (UPPER(TRIM(s.chapter)) = UPPER(TRIM(d.chapter)) OR COALESCE(TRIM(d.chapter), '') = ''))
       AS siblings_with_phone,
       e.name AS event
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE UPPER(TRIM(d.first_name)) IN ('MALE', 'FEMALE')
ORDER BY d.last_name;

-- ---------------------------------------------------------------------------
-- STEP B — full district distribution in the 2026 Lagos National Convention
--          event (this is where the 'missing' rows actually sit; SE1 ~1218
--          against the expected ~1254). Replace the name if your event differs.
-- ---------------------------------------------------------------------------
WITH ev AS (SELECT event_id FROM events WHERE name = '2026 Lagos National Convention')
SELECT d.district, count(*) AS cnt
FROM delegates d
WHERE d.event_id IN (SELECT event_id FROM ev)
GROUP BY d.district
ORDER BY cnt DESC;

-- ---------------------------------------------------------------------------
-- STEP C — for confirmation: every SE1-family row that is NOT the official
--          'South East 1' label in the Lagos event (Anambra / SED1 / blank /
--          Nigeria / South East District 1 etc.).
-- ---------------------------------------------------------------------------
WITH ev AS (SELECT event_id FROM events WHERE name = '2026 Lagos National Convention')
SELECT d.district, count(*) AS cnt
FROM delegates d
JOIN ev ON ev.event_id = d.event_id
WHERE TRIM(d.district) ILIKE '%South East%'
   OR UPPER(TRIM(d.district)) IN ('SED 1', 'SED1', 'ANAMBRA', 'NIGERIA', 'S', '1')
GROUP BY d.district
ORDER BY cnt DESC;

-- ---------------------------------------------------------------------------
-- After you review STEP A (siblings_with_phone):
--
-- (1) Rows with siblings_with_phone > 0  -> DELETE the mangled duplicate
--     (dependents cascade):
--       DELETE FROM delegates WHERE delegate_id IN (
--          SELECT d.delegate_id FROM delegates d
--          WHERE UPPER(TRIM(d.first_name)) IN ('MALE','FEMALE')
--            AND (SELECT count(*) FROM delegates s
--                 WHERE s.event_id = d.event_id AND s.delegate_id <> d.delegate_id
--                   AND UPPER(TRIM(s.last_name)) = UPPER(TRIM(d.last_name))
--                   AND COALESCE(TRIM(s.phone),'') <> '') > 0
--       );
--
-- (2) Rows with siblings_with_phone = 0  -> REPAIR first_name/district/chapter
--     from the source file where known, e.g. the SE1 file gives CHUKWUMA:
--       UPDATE delegates
--       SET first_name = 'Uche', district = 'South East 1',
--           chapter = 'NNEWI MAIN', phone = '08060319875'
--       WHERE delegate_id = '819d3feb-568e-4b42-a69a-6f214f121936';
--     (Left the EFOBI/IGWEONU/BENJANIN/ELIJAH first names blank — they are not
--      in any CSV in your Downloads; confirm with the district registrar if a
--      correct copy does not already exist.)
-- ============================================================
-- NOTE: this script is also achievable in-app with v1.34 — DataModule ->
-- Junk Row Cleanup (Scan flags the gender-as-name rows) once you know whether
-- to delete (duplicate) or repair.
-- ============================================================