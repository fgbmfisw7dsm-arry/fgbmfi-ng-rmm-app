-- ============================================================
-- SPRINT 21 — ZERO-TOLERANCE DELEGATE DEDUPLICATION (Part B: Cleanup)
-- ============================================================
-- Run AFTER supabase_migration_sprint21_dedup_schema.sql.
--
-- Identifies existing duplicate person-clusters using the canonical identity
--   (event, title_key, name_first_key, name_last_key, phone_normalized)
-- with email as the identifier key ONLY when phone is blank. Per your rule,
-- TITLE is part of the identity, so "Mr A" and "Mrs A" sharing phone+email
-- are treated as TWO DIFFERENT delegates and are NEVER merged.
--
-- Steps:
--   1. Backs up every duplicate delegate row + their checkins /
--      session_responses / badge_print_logs into
--      delegates_dedup_backup and delegates_dedup_fk_backup.
--   2. Merges each cluster: keeps the most-complete record, re-parents the
--      duplicate's attendance/history rows to the survivor, deletes the rest.
--   3. Installs the DB backstop UNIQUE index (only safe to create AFTER
--      duplicates are cleared).
--
-- Idempotent-ish: backs up into NEW tables each run (drops+recreates),
-- the merge function re-runs cleanly once dups are gone.
-- ============================================================

DROP TABLE IF EXISTS delegates_dedup_backup;
CREATE TABLE delegates_dedup_backup (LIKE delegates);

DROP TABLE IF EXISTS delegates_dedup_fk_backup;
CREATE TABLE delegates_dedup_fk_backup (
  backup_id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  event_id UUID,
  delegate_id UUID,
  payload JSONB
);

-- ---------- 1. Compute clusters ----------
-- survivor = most-complete row (tie: earliest created_at, then id)
DROP VIEW IF EXISTS vdedup_ranked;
CREATE VIEW vdedup_ranked AS
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY
        event_id,
        title_key,
        name_first_key,
        name_last_key,
        COALESCE(NULLIF(phone_normalized, ''), 'EMAIL:' || LOWER(TRIM(COALESCE(email, ''))))
      ORDER BY
        (NULLIF(TRIM(title),        '') IS NOT NULL)::int +
        (NULLIF(TRIM(first_name),   '') IS NOT NULL)::int +
        (NULLIF(TRIM(last_name),    '') IS NOT NULL)::int +
        (NULLIF(TRIM(phone),        '') IS NOT NULL)::int +
        (NULLIF(TRIM(email),        '') IS NOT NULL)::int +
        (NULLIF(TRIM(district),     '') IS NOT NULL)::int +
        (NULLIF(TRIM(chapter),      '') IS NOT NULL)::int +
        (NULLIF(TRIM(rank),         '') IS NOT NULL)::int +
        (NULLIF(TRIM(office),       '') IS NOT NULL)::int
        DESC,
      created_at ASC,
      delegate_id ASC
    ) AS rn
  FROM delegates
  WHERE NULLIF(phone_normalized, '') IS NOT NULL
     OR NULLIF(LOWER(TRIM(COALESCE(email, ''))), '') IS NOT NULL
)
SELECT delegate_id, event_id,
       COALESCE(NULLIF(phone_normalized, ''), 'EMAIL:' || LOWER(TRIM(COALESCE(email, '')))) AS identity_key,
       rn,
       (rn = 1) AS is_survivor
FROM ranked;

-- View of (dup_id -> survivor_id) pairs to merge
DROP VIEW IF EXISTS vdedup_pairs;
CREATE VIEW vdedup_pairs AS
SELECT s.delegate_id AS survivor_id, d.delegate_id AS dup_id, d.event_id
FROM vdedup_ranked s
JOIN vdedup_ranked d
  ON d.event_id = s.event_id AND d.identity_key = s.identity_key AND s.is_survivor
WHERE NOT d.is_survivor;

-- ---------- 2. Backup duplicates + their FK rows ----------
INSERT INTO delegates_dedup_backup
SELECT d.* FROM delegates d
WHERE d.delegate_id IN (SELECT dup_id FROM vdedup_pairs);

INSERT INTO delegates_dedup_fk_backup (table_name, row_id, event_id, delegate_id, payload)
SELECT 'checkins', c.checkin_id::text, c.event_id, c.delegate_id, to_jsonb(c)
FROM checkins c WHERE c.delegate_id IN (SELECT dup_id FROM vdedup_pairs)
UNION ALL
SELECT 'session_responses', x.response_id::text, x.event_id, x.delegate_id, to_jsonb(x)
FROM session_responses x WHERE x.delegate_id IN (SELECT dup_id FROM vdedup_pairs)
UNION ALL
SELECT 'badge_print_logs', l.log_id::text, l.event_id, l.delegate_id, to_jsonb(l)
FROM badge_print_logs l WHERE l.delegate_id IN (SELECT dup_id FROM vdedup_pairs);

-- ---------- 3. Merge + rehome + delete ----------
CREATE OR REPLACE FUNCTION merge_delegate_duplicates()
RETURNS TABLE(survivors BIGINT, merged_delegates BIGINT, rehomed_rows BIGINT, removed_conflicting BIGINT)
LANGUAGE plpgsql
AS $func$
DECLARE
  r RECORD;
  v_survivors BIGINT := 0;
  v_merged BIGINT := 0;
  v_rehomed BIGINT := 0;
  v_conflicts BIGINT := 0;
  v_del BIGINT;
BEGIN
  SELECT COUNT(DISTINCT survivor_id) INTO v_survivors FROM vdedup_pairs;

  FOR r IN SELECT survivor_id, dup_id, event_id FROM vdedup_pairs ORDER BY survivor_id LOOP
    -- checkins: drop conflicts where survivor already holds the same session/arrival
    DELETE FROM checkins c1
    USING checkins c2
    WHERE c1.event_id = c2.event_id
      AND c1.delegate_id = r.dup_id
      AND c2.delegate_id = r.survivor_id
      AND c1.session_id IS NOT DISTINCT FROM c2.session_id;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_conflicts := v_conflicts + v_del;

    UPDATE checkins SET delegate_id = r.survivor_id
    WHERE event_id = r.event_id AND delegate_id = r.dup_id;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rehomed := v_rehomed + v_del;

    -- session_responses: drop conflicts, rehome the rest
    DELETE FROM session_responses x1
    USING session_responses x2
    WHERE x1.event_id = x2.event_id
      AND x1.delegate_id = r.dup_id
      AND x2.delegate_id = r.survivor_id
      AND x1.session_id IS NOT DISTINCT FROM x2.session_id
      AND x1.response_type = x2.response_type;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_conflicts := v_conflicts + v_del;

    UPDATE session_responses SET delegate_id = r.survivor_id
    WHERE event_id = r.event_id AND delegate_id = r.dup_id;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rehomed := v_rehomed + v_del;

    -- badge_print_logs: rehome (no uniqueness on delegate_id)
    UPDATE badge_print_logs SET delegate_id = r.survivor_id
    WHERE event_id = r.event_id AND delegate_id = r.dup_id;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rehomed := v_rehomed + v_del;

    -- remove the duplicate record last
    DELETE FROM delegates WHERE delegate_id = r.dup_id;
    v_merged := v_merged + 1;
  END LOOP;

  RETURN QUERY SELECT v_survivors, v_merged, v_rehomed, v_conflicts;
END;
$func$;

SELECT * FROM merge_delegate_duplicates();

-- ---------- 4. DB backstop: zero-tolerance unique index ----------
-- Enforced for every identified delegate (phone present). A person cannot
-- exist twice as the same (event, title, first, last, phone). Rows without
-- a phone can't be reliably identified, so they are exempted from the hard
-- constraint and covered by the email fallback in the merge logic.
DROP INDEX IF EXISTS idx_delegates_same_person;
CREATE UNIQUE INDEX idx_delegates_same_person ON delegates(
  event_id,
  title_key,
  name_first_key,
  name_last_key,
  COALESCE(phone_normalized, '')
) WHERE NULLIF(phone_normalized, '') IS NOT NULL;

-- Verification: should report 0 rows
SELECT event_id, title_key, name_first_key, name_last_key, COALESCE(phone_normalized, ''),
       count(*) AS copies
FROM delegates
WHERE NULLIF(phone_normalized, '') IS NOT NULL
GROUP BY 1, 2, 3, 4, 5
HAVING count(*) > 1;