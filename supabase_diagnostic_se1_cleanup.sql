-- ============================================================
-- SE1 BLOAT CLEANUP — remove the 23 re-imported duplicates.
--
-- Root cause (confirmed): SE1 was imported more than once. A first batch
-- (~2026-08-23 23:24) loaded 1,260 rows; a second batch (~2026-08-24 00:40)
-- and a third (~2026-08-24 12:42) re-imported 23 of the same people. Because
-- the second/third rows carried the 'Surname, Initial' form (e.g. "ANTHONY ,
-- O." vs "ANTHONY"), their identity keys didn't match the originals, so the
-- dedup update merged nobody and they were inserted as NEW rows -> +23.
--
-- DB=1,283, file=1,260. Deleting the 23 second+/third-batch duplicates that
-- copy a first-batch person restores exactly 1,260.
--
-- All queries below are read-only except the explicitly-marked DELETE.
-- ============================================================

-- 0) SAFETY: do any of the 23 duplicate rows carry check-in/attendance data?
--    If this returns rows, those dupes have attendance we must merge first
--    (the DELETE would otherwise orphan/cascade them). Expect 0 rows.
SELECT c.delegate_id, count(*) AS checkins
FROM checkins c
WHERE c.event_id = '4b368055-89a5-4412-a3f0-648d1fd9090f'
  AND c.delegate_id IN (
    WITH batched AS (
      SELECT d.delegate_id,
             regexp_replace(upper(regexp_replace(
                regexp_replace(coalesce(d.first_name,'') || '|' || coalesce(d.last_name,''),
                  ', ?[A-Z]\.?$', '', 'g'),
                '[^A-Z]','','g')),'^X$','') AS base_key,
             (d.created_at < '2026-08-24') AS first_batch
      FROM delegates d
      WHERE UPPER(TRIM(d.district)) IN ('SOUTH EAST 1','SED 1','ANAMBRA')
    ),
    dupes AS (
      SELECT base_key FROM batched
      GROUP BY base_key
      HAVING count(*) FILTER (WHERE first_batch) > 0
         AND count(*) FILTER (WHERE NOT first_batch) > 0
    )
    SELECT b.delegate_id FROM batched b
    JOIN dupes du ON du.base_key = b.base_key
    WHERE NOT b.first_batch
  )
GROUP BY c.delegate_id;

-- 1) Preview the exact 23 duplicate rows that will be deleted
--    (every South East 1 row in a second/third batch whose base name also
--     exists in the first batch).
WITH batched AS (
  SELECT d.delegate_id, d.title, d.first_name, d.last_name, d.chapter, d.created_at,
         regexp_replace(upper(regexp_replace(
            regexp_replace(coalesce(d.first_name,'') || '|' || coalesce(d.last_name,''),
              ', ?[A-Z]\.?$', '', 'g'),
            '[^A-Z]','','g')),'^X$','') AS base_key,
         (d.created_at < '2026-08-24') AS first_batch
  FROM delegates d
  WHERE UPPER(TRIM(d.district)) IN ('SOUTH EAST 1','SED 1','ANAMBRA')
),
dupes AS (
  SELECT base_key FROM batched
  GROUP BY base_key
  HAVING count(*) FILTER (WHERE first_batch) > 0
     AND count(*) FILTER (WHERE NOT first_batch) > 0
)
SELECT b.delegate_id, b.title, b.first_name, b.last_name, b.chapter, b.created_at
FROM batched b
JOIN dupes du ON du.base_key = b.base_key
WHERE NOT b.first_batch
ORDER BY b.last_name, b.first_name;

-- 2) Count to delete (expect 23).
WITH batched AS (
  SELECT d.delegate_id,
         regexp_replace(upper(regexp_replace(
            regexp_replace(coalesce(d.first_name,'') || '|' || coalesce(d.last_name,''),
              ', ?[A-Z]\.?$', '', 'g'),
            '[^A-Z]','','g')),'^X$','') AS base_key,
         (d.created_at < '2026-08-24') AS first_batch
  FROM delegates d
  WHERE UPPER(TRIM(d.district)) IN ('SOUTH EAST 1','SED 1','ANAMBRA')
),
dupes AS (
  SELECT base_key FROM batched
  GROUP BY base_key
  HAVING count(*) FILTER (WHERE first_batch) > 0
     AND count(*) FILTER (WHERE NOT first_batch) > 0
)
SELECT count(*) AS rows_to_delete
FROM batched b JOIN dupes du ON du.base_key = b.base_key
WHERE NOT b.first_batch;

-- ============================================================
-- STEP 3 — OPTIONAL DELETE (run ONLY after query 0 returns 0 rows and you
-- have reviewed query 1/2). Deletes the 23 re-imported duplicates.
-- ============================================================
-- BEGIN;
-- WITH batched AS (
--   SELECT d.delegate_id,
--          regexp_replace(upper(regexp_replace(
--             regexp_replace(coalesce(d.first_name,'') || '|' || coalesce(d.last_name,''),
--               ', ?[A-Z]\.?$', '', 'g'),
--             '[^A-Z]','','g')),'^X$','') AS base_key,
--          (d.created_at < '2026-08-24') AS first_batch
--   FROM delegates d
--   WHERE UPPER(TRIM(d.district)) IN ('SOUTH EAST 1','SED 1','ANAMBRA')
-- ),
-- dupes AS (
--   SELECT base_key FROM batched
--   GROUP BY base_key
--   HAVING count(*) FILTER (WHERE first_batch) > 0
--      AND count(*) FILTER (WHERE NOT first_batch) > 0
-- )
-- DELETE FROM delegates d
-- USING batched b
-- WHERE d.delegate_id = b.delegate_id
--   AND b.base_key IN (SELECT base_key FROM dupes)
--   AND NOT b.first_batch;
-- COMMIT;

-- ============================================================
-- STEP 4 — CONFIRM
-- ============================================================
-- SELECT count(*) AS se1_total_after
-- FROM delegates
-- WHERE UPPER(TRIM(district)) IN ('SOUTH EAST 1','SED 1','ANAMBRA');
-- Expect: 1,260.
