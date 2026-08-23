-- ============================================================
-- NC3 JUNK-ROW CLEANUP v2 — event-name agnostic (manual run in SQL editor)
-- ============================================================
-- v1 failed to delete the imported junk rows because the NC3 delegates are
-- hosted in an event whose name does not contain 'NC3' / 'North Central 3',
-- so the name filter matched zero events and the backup table was empty.
--
-- This version does NOT depend on the event name. It locates junk rows by
-- their DATA signature (blank or purely-numeric first/last names, header-word
-- names, note-fragment names) across ALL events, so it finds them wherever
-- they landed. It still backs up first and shows a preview you must review
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
-- 1a. Events + delegate counts (find the event hosting the NC3 import):
SELECT e.event_id, e.name, count(d.delegate_id) AS delegates
FROM events e
LEFT JOIN delegates d ON d.event_id = e.event_id
GROUP BY e.event_id, e.name
ORDER BY delegates DESC;

-- 1b. Junk candidates across ALL events (blank / pure-numeric / header-word names):
SELECT e.name AS event, d.delegate_id, d.title, d.first_name, d.last_name,
       d.district, d.chapter, d.phone, d.email
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE (
  COALESCE(TRIM(d.first_name), '') = ''
  OR COALESCE(TRIM(d.last_name), '') = ''
  OR (TRIM(d.first_name) <> '' AND TRIM(d.first_name) !~ '[A-Za-z]')
  OR (TRIM(d.last_name) <> '' AND TRIM(d.last_name) !~ '[A-Za-z]')
  OR UPPER(TRIM(d.first_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:')
  OR UPPER(TRIM(d.last_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:')
  OR TRIM(d.first_name) ~ '>'
  OR TRIM(d.last_name) ~ '>'
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
  OR UPPER(TRIM(d.first_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:')
  OR UPPER(TRIM(d.last_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:')
  OR TRIM(d.first_name) ~ '>'
  OR TRIM(d.last_name) ~ '>'
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
);

-- To restore the backup if ever needed ==============================
-- INSERT INTO delegates (SELECT * FROM _junk_backup);
-- ===================================================================