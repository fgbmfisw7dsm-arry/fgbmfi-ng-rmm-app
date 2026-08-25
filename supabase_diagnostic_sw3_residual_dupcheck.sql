-- ============================================================================
-- SW3 Residual-Duplicate Verification (read-only)
-- ----------------------------------------------------------------------------
-- After "Reconcile Title Variants" (v1.37d/e) the event's SW3 count should be
-- ~251 (the portal CSV has 260 rows minus 9 internal duplicate rows; the SW7
-- precedent was 596 vs its ~600 distinct people). This script, run against the
-- 2026 Lagos National Convention event, confirms there are NO residual
-- duplicates in South West 3 before closing the case.
--
-- All statements are SELECT-only. Nothing is written.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Confirmation: total SW3 delegates in the event
-- ---------------------------------------------------------------------------
SELECT d.district, count(*) AS sw3_delegates
FROM delegates d JOIN events e ON e.event_id = d.event_id
WHERE e.name = '2026 Lagos National Convention' AND d.district ILIKE '%South West 3%'
GROUP BY d.district;
-- EXPECT: South West 3 | ~251

-- ---------------------------------------------------------------------------
-- 1. Residual duplicates by normalised phone within SW3
--    (two rows sharing the same phone AND the same family-aware name key are
--     the same person; the app's merge should have collapsed them to one).
-- ---------------------------------------------------------------------------
WITH sw AS (
  SELECT d.delegate_id, d.title, d.first_name, d.last_name,
         coalesce(d.phone_normalized,'') AS phone,
         lower(coalesce(d.email,'')) AS email,
         array_to_string(ARRAY(SELECT w FROM regexp_split_to_table(
             regexp_replace(lower(coalesce(d.first_name,'')||' '||coalesce(d.last_name,'')),
                            '[^a-z0-9 ]', ' ', 'g'), ' ') w
           WHERE length(w) > 0
             AND w NOT IN ('mr','mrs','ms','miss','dr','chief','pastor','rev','engr','barr',
                           'prof','sir','lady','hon','elder','deacon','deaconess','bishop','apostle',
                           'evangelist','ven','snr','bro','sis','prince','princess','oba','alhaji',
                           'alhaja','mallam','hajia','arch','archt','comrade','evang','evng','pst',
                           'eld','sen','esq','otunba','capt','maj','lt','col','cmdr','adm','amb',
                           'ambassador','master','mst','mstr','esv','pharm','drs','supt')
           ORDER BY w), ' ') AS base_name_key
  FROM delegates d JOIN events e ON e.event_id = d.event_id
  WHERE e.name = '2026 Lagos National Convention' AND d.district ILIKE '%South West 3%'
)
SELECT base_name_key, phone,
  count(*) AS n_rows,
  array_agg(delegate_id) AS ids,
  array_agg(title||'|'||first_name||' '||last_name) AS stored
FROM sw
GROUP BY base_name_key, phone
HAVING base_name_key <> '' AND count(*) > 1
ORDER BY count(*) DESC, base_name_key;
-- EXPECT: 0 rows. Any row here is a residual same-phone duplicate.

-- ---------------------------------------------------------------------------
-- 2. Residual duplicates by family-aware name key ONLY (any phone), within SW3
--    The family prefix (first |) protects dependants (master/mst/miss) and M/F.
--    This gap-fills NAME collisions that the app's autoMerge may have skipped
--    (e.g. different-phone same-name, or a 2+ contact-bearing cluster).
-- ---------------------------------------------------------------------------
SELECT
  split_part(d.name_key, '|', 1) AS family,
  split_part(d.name_key, '|', 2) AS base_name_key,
  count(*) AS n_rows,
  array_agg(d.delegate_id) AS ids,
  array_agg(d.title||'|'||d.first_name||' '||d.last_name) AS stored,
  array_agg(coalesce(d.phone_normalized,'')) AS phones
FROM delegates d
JOIN events e ON e.event_id = d.event_id
WHERE e.name = '2026 Lagos National Convention'
  AND d.district ILIKE '%South West 3%'
  AND NULLIF(split_part(d.name_key, '|', 2), '') IS NOT NULL
GROUP BY split_part(d.name_key, '|', 1), split_part(d.name_key, '|', 2)
HAVING count(*) > 1
ORDER BY count(*) DESC, split_part(d.name_key, '|', 2);
-- EXPECT: 0 rows for a clean close. If rows appear:
--   * family = DEP -> dependant rows kept apart (by design, review manually)
--   * phones differ across the group -> kept apart (different people, by design)
--   * same phone + same base name + same family -> RESIDUAL DUPLICATE (needs merge)

-- ---------------------------------------------------------------------------
-- 3. Residual same-name diff-phone pairs (the "different people" guard) —
--    informational, NOT duplicates. Lists name keys with 2+ distinct phones.
-- ---------------------------------------------------------------------------
SELECT family,
       base_key,
       count(*) AS n_rows,
       count(DISTINCT phone) AS distinct_phones,
       array_agg(stored) AS stored
FROM (
  SELECT split_part(d.name_key, '|', 1) AS family,
         split_part(d.name_key, '|', 2) AS base_key,
         d.title||'|'||d.first_name||' '||d.last_name AS stored,
         coalesce(d.phone_normalized,'') AS phone
  FROM delegates d JOIN events e ON e.event_id = d.event_id
  WHERE e.name = '2026 Lagos National Convention'
    AND d.district ILIKE '%South West 3%'
) t
WHERE base_key <> ''
GROUP BY family, base_key
HAVING count(*) > 1 AND count(DISTINCT phone) > 1
ORDER BY n_rows DESC;
-- Multi-distinct phones within one name key = likely DIFFERENT people (father/
-- mother/child or two adults sharing a name), deliberately NOT merged (v1.37e).

-- ---------------------------------------------------------------------------
-- 3A. Inspect a specific same-name diff-phone pair in full, to decide
--     MERGE vs KEEP. Edit <base_key> to the base_key from query 3 output
--     (e.g. 'lanre taiwo'). Read-only.
-- ---------------------------------------------------------------------------
SELECT d.delegate_id, d.title, d.first_name, d.last_name,
       coalesce(d.phone_normalized,'') AS phone,
       lower(coalesce(d.email,'')) AS email,
       d.chapter, d.registration_source,
       d.created_at::date,
       (SELECT count(*) FROM checkins c WHERE c.delegate_id = d.delegate_id) AS checkins
FROM delegates d JOIN events e ON e.event_id = d.event_id
WHERE e.name = '2026 Lagos National Convention'
  AND d.district ILIKE '%South West 3%'
  AND split_part(d.name_key, '|', 2) = '<base_key>'
ORDER BY coalesce(d.phone_normalized,''), d.created_at;
-- Decide: if email or chapter matches across the pair → SAME person (mergable);
-- if a scan/badge history suggests two people or emails differ → KEEP separate.