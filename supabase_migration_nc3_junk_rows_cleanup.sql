-- ============================================================
-- NC3 JUNK-ROW CLEANUP — manual run in the Supabase SQL editor
-- ============================================================
-- Problem: importing Combined_NC3_Registrations_Formatted csv pulled in the
-- trailing summary block (`Zone Summary`, `ZONE,Adults,Teens,...`,
-- `UPZ I,78,2,5,...`, `GRAND TOTAL,...`, `Notes:`) as delegates with
-- numeric/blank first/last names. They appear at the TOP of the Master List
-- because digits sort before letters in last_name ordering.
--
-- This script removes exactly those rows for the NC3 event only. It backs up
-- first, so you can restore with a one-line INSERT if anything looks wrong.
--
-- HOW TO RUN:
--   1. Run STEP A  and confirm it returns your NC3 event (edit the name
--      pattern if your event is named differently).
--   2. Run STEP B  and REVIEW the candidate list — make sure ONLY junk rows
--      (numeric/blank names) are listed, no real delegates.
--   3. Run STEP C  to delete (dependents first: badge_print_logs,
--      session_responses, checkins, then delegates).
--   4. Run STEP D  sanity checks.
-- ============================================================

-- ---------------------------------------------------------------------------
-- STEP A — resolve the NC3 event id
-- ---------------------------------------------------------------------------
SELECT event_id, name
FROM events
WHERE name ILIKE '%NC3%' OR name ILIKE '%North Central 3%'
ORDER BY created_at DESC;

-- ---------------------------------------------------------------------------
-- STEP B — backup + preview the candidates (REVIEW BEFORE DELETING)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _nc3_junk_backup;
CREATE TABLE _nc3_junk_backup AS
SELECT d.*
FROM delegates d
JOIN events e USING (event_id)
WHERE (e.name ILIKE '%NC3%' OR e.name ILIKE '%North Central 3%')
  AND (
    COALESCE(TRIM(d.first_name), '') = ''
    OR COALESCE(TRIM(d.last_name), '') = ''
    OR (TRIM(d.first_name) <> '' AND TRIM(d.first_name) !~ '[A-Za-z]')
    OR (TRIM(d.last_name) <> '' AND TRIM(d.last_name) !~ '[A-Za-z]')
    OR UPPER(TRIM(d.first_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:')
    OR UPPER(TRIM(d.last_name)) IN ('ZONE', 'CAT', 'ADULTS', 'TEENS', 'CHILDREN', 'TOTAL', 'SUBTOTAL', 'GRAND TOTAL', 'SUMMARY', 'ZONE SUMMARY', 'NOTES:')
    OR TRIM(d.first_name) ~ '>'
    OR TRIM(d.last_name) ~ '>'
  );

SELECT delegate_id, title, first_name, last_name, district, chapter, phone, email
FROM _nc3_junk_backup
ORDER BY last_name NULLS FIRST, first_name NULLS FIRST;

-- ---------------------------------------------------------------------------
-- STEP C — delete (dependents first, then the delegates)
-- ---------------------------------------------------------------------------
DELETE FROM badge_print_logs  WHERE delegate_id IN (SELECT delegate_id FROM _nc3_junk_backup);
DELETE FROM session_responses WHERE delegate_id IN (SELECT delegate_id FROM _nc3_junk_backup);
DELETE FROM checkins          WHERE delegate_id IN (SELECT delegate_id FROM _nc3_junk_backup);
DELETE FROM delegates         WHERE delegate_id IN (SELECT delegate_id FROM _nc3_junk_backup);

-- ---------------------------------------------------------------------------
-- STEP D — sanity checks (should all be 0)
-- ---------------------------------------------------------------------------
SELECT count(*) AS remaining_junk
FROM delegates d
JOIN events e USING (event_id)
WHERE (e.name ILIKE '%NC3%' OR e.name ILIKE '%North Central 3%')
  AND (
    COALESCE(TRIM(d.first_name), '') = ''
    OR COALESCE(TRIM(d.last_name), '') = ''
    OR (TRIM(d.first_name) <> '' AND TRIM(d.first_name) !~ '[A-Za-z]')
    OR (TRIM(d.last_name) <> '' AND TRIM(d.last_name) !~ '[A-Za-z]')
  );

SELECT count(*) AS backed_up
FROM _nc3_junk_backup;

-- To restore the backup if ever needed:
-- INSERT INTO delegates SELECT * FROM _nc3_junk_backup;