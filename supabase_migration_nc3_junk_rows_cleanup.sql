-- ============================================================
-- NC3 JUNK-ROW CLEANUP v3 — event-name agnostic (manual run in SQL editor)
-- ============================================================
-- v1 filtered by event name ILIKE and matched zero events; v2 became
-- event-name agnostic. This v3 also catches MANGLED COLUMN-SHIFT rows
-- (legacy comma-splitter artifacts): gender-as-name (first/last = MALE/FEMALE),
-- country-as-district (district = NIGERIA etc.), and district-code-as-chapter
-- (chapter matches ^[A-Z]{2}D?<n>$ like 'SED1').
--
-- This version does NOT depend on the event name. It locates junk rows by
-- their DATA signature across ALL events, so it finds them wherever they
-- landed. It still backs up first and shows a preview you must review
-- before Step 4 deletes.
--
-- Deleting a delegate cascades to its dependents automatically because the
-- schema uses ON DELETE CASCADE on checkins, session_responses and
-- badge_print_logs.delegate_id (verified in the live schema dump).
--
-- HOW TO RUN (strictly in order):
--   1. Step 1 = inspect. Run it and review the list.
--   2. Step 2 = backup + Step 3 = preview candidate count (run both).
--   3. Step 4 = DELETE — only after you confirm ONLY junk rows are listed.
--   4. Step 5 = verify. Should return 0 remaining junk.
-- ============================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — see where your districts live + confirm the junk rows are present
-- ---------------------------------------------------------------------------
-- 1a. Events + delegate counts (find the event hosting the NC3/SE1 import):
SELECT e.event_id, e.name, count(d.delegate_id) AS delegates
FROM events e
LEFT JOIN delegates d ON d.event_id = e.event_id
GROUP BY e.event_id, e.name
ORDER BY delegates DESC;

-- 1b. Junk candidates across ALL events (blank / pure-numeric / header-word /
--     note-fragment / mangled-shift names):
SELECT e.name AS event, d.delegate_id, d.title, d.first_name, d.last_name,
       d.district, d.chapter, d.phone, d.email
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE (
  COALESCE(TRIM(d.first_name), '') = ''
  OR COALESCE(TRIM(d.last_name), '') = ''
  OR (TRIM(d.first_name) <> '' AND TRIM(d.first_name) !~ '[A-Za-z]')
  OR (TRIM(d.last_name) <> '' AND TRIM(d.last_name) !~ '[A-Za-z]')
  OR TRIM(d.first_name) ~ '^\d'
  OR TRIM(d.last_name) ~ '^\d'
  OR TRIM(d.first_name) ~ '[=<>]'
  OR TRIM(d.last_name) ~ '[=<>]'
  OR UPPER(TRIM(d.first_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:', 'MALE', 'FEMALE')
  OR UPPER(TRIM(d.last_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:', 'MALE', 'FEMALE')
  OR UPPER(TRIM(d.first_name)) LIKE '%RECORDS%'
  OR UPPER(TRIM(d.first_name)) LIKE '%SOURCE:%'
  OR UPPER(TRIM(d.last_name)) LIKE '%RECORDS%'
  OR UPPER(TRIM(d.last_name)) LIKE '%SOURCE:%'
  OR UPPER(TRIM(d.district)) IN ('NIGERIA', 'GHANA', 'CAMEROON', 'BENIN', 'TOGO', 'NIGER', 'LIBERIA', 'SIERRA LEONE', 'SOUTH AFRICA', 'KENYA', 'USA', 'UK', 'UNITED KINGDOM', 'CANADA', 'UAE', 'CHINA', 'INDIA')
  OR TRIM(d.chapter) ~ '^[A-Z]{2}D?[0-9]+$'
)
ORDER BY d.last_name NULLS FIRST, d.first_name NULLS FIRST;

-- ---------------------------------------------------------------------------
-- STEP 2 — back up the candidates
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _junk_backup;
CREATE TABLE _junk_backup AS
SELECT d.*
FROM delegates d
WHERE (
  COALESCE(TRIM(d.first_name), '') = ''
  OR COALESCE(TRIM(d.last_name), '') = ''
  OR (TRIM(d.first_name) <> '' AND TRIM(d.first_name) !~ '[A-Za-z]')
  OR (TRIM(d.last_name) <> '' AND TRIM(d.last_name) !~ '[A-Za-z]')
  OR TRIM(d.first_name) ~ '^\d'
  OR TRIM(d.last_name) ~ '^\d'
  OR TRIM(d.first_name) ~ '[=<>]'
  OR TRIM(d.last_name) ~ '[=<>]'
  OR UPPER(TRIM(d.first_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:', 'MALE', 'FEMALE')
  OR UPPER(TRIM(d.last_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:', 'MALE', 'FEMALE')
  OR UPPER(TRIM(d.first_name)) LIKE '%RECORDS%'
  OR UPPER(TRIM(d.first_name)) LIKE '%SOURCE:%'
  OR UPPER(TRIM(d.last_name)) LIKE '%RECORDS%'
  OR UPPER(TRIM(d.last_name)) LIKE '%SOURCE:%'
  OR UPPER(TRIM(d.district)) IN ('NIGERIA', 'GHANA', 'CAMEROON', 'BENIN', 'TOGO', 'NIGER', 'LIBERIA', 'SIERRA LEONE', 'SOUTH AFRICA', 'KENYA', 'USA', 'UK', 'UNITED KINGDOM', 'CANADA', 'UAE', 'CHINA', 'INDIA')
  OR TRIM(d.chapter) ~ '^[A-Z]{2}D?[0-9]+$'
);

-- ---------------------------------------------------------------------------
-- STEP 3 — preview candidate COUNT (review before deleting)
-- ---------------------------------------------------------------------------
SELECT count(*) AS junk_candidates FROM _junk_backup;

-- ---------------------------------------------------------------------------
-- STEP 4 — DELETE (dependents cascade automatically). Only run after review.
-- ---------------------------------------------------------------------------
DELETE FROM delegates WHERE delegate_id IN (SELECT delegate_id FROM _junk_backup);

-- ---------------------------------------------------------------------------
-- STEP 5 — verify: remaining junk should be 0
-- ---------------------------------------------------------------------------
SELECT count(*) AS remaining_junk
FROM delegates d
WHERE (
  COALESCE(TRIM(d.first_name), '') = ''
  OR COALESCE(TRIM(d.last_name), '') = ''
  OR (TRIM(d.first_name) <> '' AND TRIM(d.first_name) !~ '[A-Za-z]')
  OR (TRIM(d.last_name) <> '' AND TRIM(d.last_name) !~ '[A-Za-z]')
  OR UPPER(TRIM(d.first_name)) IN ('MALE', 'FEMALE')
  OR UPPER(TRIM(d.last_name)) IN ('MALE', 'FEMALE')
  OR UPPER(TRIM(d.district)) IN ('NIGERIA', 'GHANA', 'CAMEROON', 'BENIN', 'TOGO', 'NIGER', 'LIBERIA', 'SIERRA LEONE', 'SOUTH AFRICA', 'KENYA', 'USA', 'UK', 'UNITED KINGDOM', 'CANADA', 'UAE', 'CHINA', 'INDIA')
  OR TRIM(d.chapter) ~ '^[A-Z]{2}D?[0-9]+$'
);

-- To restore the backup if ever needed ==============================
-- INSERT INTO delegates (SELECT * FROM _junk_backup);
-- ===================================================================