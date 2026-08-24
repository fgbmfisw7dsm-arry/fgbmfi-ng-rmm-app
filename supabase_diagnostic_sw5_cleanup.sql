-- ============================================================
-- SW5 CLEANUP + RE-IMPORT DIAGNOSTIC
--
-- CONTEXT: The SW5 Formatted CSV has a BLANK first header cell while its data
-- rows carry a serial number in column 0. The old import dropped the empty
-- header cell, shifting every mapped column one slot left, so most SW5 rows
-- were written with junk Title/Chapter/Email/Phone/First/Last (e.g. Title="Male",
-- Chapter="1", Phone=an email). The fix (ImportModule parseHeaders) is deployed;
-- these queries find and delete the junk rows so a clean re-import of
-- SW5_Registrations_Canonical.csv can run.
--
-- Host event = 2026 Lagos National Convention = 4b368055-89a5-4412-a3f0-648d1fd9090f
-- All queries below are read-only except the explicitly-marked DELETE.
-- ============================================================

-- 1) All SW5-flagged rows currently in the host event (district = South West 5),
--    so we can see the mis-aligned junk signature live.
SELECT d.delegate_id, d.title, d.first_name, d.last_name,
       d.chapter, d.email, d.phone, d.district, d.registration_source
FROM delegates d
WHERE d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
  AND UPPER(TRIM(d.district)) IN ('SOUTH WEST 5', 'SW 5', 'SW5')
ORDER BY d.last_name, d.first_name;

-- 2) Count the clearly-junk SW5 rows (the ones that must be deleted before
--    re-import). Signature of the shifted import:
--      * Title is a gender word ('Male'/'Female'), OR
--      * Chapter looks purely numeric (was the SN), OR
--      * Phone is non-numeric / looks like an email, OR
--      * First name looks like a title token (Mr/Mrs/Dr/Arc...).
SELECT count(*) AS junk_sw5_rows
FROM delegates d
WHERE d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
  AND UPPER(TRIM(d.district)) IN ('SOUTH WEST 5', 'SW 5', 'SW5')
  AND (
       UPPER(TRIM(d.title)) IN ('MALE', 'FEMALE')
    OR (COALESCE(TRIM(d.chapter), '') <> '' AND TRIM(d.chapter) ~ '^[0-9]+$')
    OR (COALESCE(TRIM(d.phone), '') <> '' AND TRIM(d.phone) !~ '^[0-9]+$')
    OR UPPER(TRIM(d.first_name)) IN ('MR', 'MRS', 'MS', 'DR', 'PROF', 'ENG', 'BARR', 'ARC', 'ELDER', 'PASTOR', 'CHIEF', 'PRINCE', 'SIR', 'LADY', 'VEN', 'EVANGELIST', 'HON', 'DEACON', 'DEACONESS', 'BISHOP', 'APOSTLE', 'MASTER')
  );

-- 3) Full list of those junk rows (review before deleting).
SELECT d.delegate_id, d.title, d.first_name, d.last_name,
       d.chapter, d.email, d.phone, d.district
FROM delegates d
WHERE d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
  AND UPPER(TRIM(d.district)) IN ('SOUTH WEST 5', 'SW 5', 'SW5')
  AND (
       UPPER(TRIM(d.title)) IN ('MALE', 'FEMALE')
    OR (COALESCE(TRIM(d.chapter), '') <> '' AND TRIM(d.chapter) ~ '^[0-9]+$')
    OR (COALESCE(TRIM(d.phone), '') <> '' AND TRIM(d.phone) !~ '^[0-9]+$')
    OR UPPER(TRIM(d.first_name)) IN ('MR', 'MRS', 'MS', 'DR', 'PROF', 'ENG', 'BARR', 'ARC', 'ELDER', 'PASTOR', 'CHIEF', 'PRINCE', 'SIR', 'LADY', 'VEN', 'EVANGELIST', 'HON', 'DEACON', 'DEACONESS', 'BISHOP', 'APOSTLE', 'MASTER')
  )
ORDER BY d.last_name, d.first_name;

-- ============================================================
-- STEP 4 — OPTIONAL DELETE (run after reviewing query 3):
-- Deletes ONLY the junk SW5 rows (same signature as queries 2/3). Legitimate
-- SW5 rows that were somehow imported cleanly are NOT touched.
-- ============================================================
-- BEGIN;
-- DELETE FROM delegates d
-- WHERE d.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
--   AND UPPER(TRIM(d.district)) IN ('SOUTH WEST 5', 'SW 5', 'SW5')
--   AND (
--        UPPER(TRIM(d.title)) IN ('MALE', 'FEMALE')
--     OR (COALESCE(TRIM(d.chapter), '') <> '' AND TRIM(d.chapter) ~ '^[0-9]+$')
--     OR (COALESCE(TRIM(d.phone), '') <> '' AND TRIM(d.phone) !~ '^[0-9]+$')
--     OR UPPER(TRIM(d.first_name)) IN ('MR', 'MRS', 'MS', 'DR', 'PROF', 'ENG', 'BARR', 'ARC', 'ELDER', 'PASTOR', 'CHIEF', 'PRINCE', 'SIR', 'LADY', 'VEN', 'EVANGELIST', 'HON', 'DEACON', 'DEACONESS', 'BISHOP', 'APOSTLE', 'MASTER')
--   );
-- COMMIT;

-- ============================================================
-- RECOMMENDED RUNBOOK
-- ============================================================
-- 1. Run queries 1-3. Review the junk rows.
-- 2. Ensure the host event is ACTIVE (is_active = true) for writes.
-- 3. Run the STEP-4 DELETE to remove the junk SW5 rows.
-- 4. In the app set ACTIVE EVENT to "2026 Lagos National Convention", then on
--    Import Data -> Bulk Delegate Import upload:
--    ...\manual regs\Districts Manual Reg Files 15-08-26\SW5_Registrations_Canonical.csv
--    (produced by preprocess_sw5_csv.py — 39 rows, all District="South West 5",
--     fields aligned, phones normalized).
-- 5. Verify: Master List, District "South West 5" shows 39 clean delegates.
-- ============================================================
