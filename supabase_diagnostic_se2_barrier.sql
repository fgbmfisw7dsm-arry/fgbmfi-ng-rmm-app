-- ============================================================
-- SE2 IMPORT BARRIER DIAGNOSTIC — run in Supabase SQL editor.
--
-- B and 2b confirmed the SE2 bulk import wrote only ~1 row (no rows under the
-- ENUGU*/EBONYI* zones, 1 under "South East 2"). The 292-row mapped file is
-- valid, so the remaining suspect is a DB-side barrier (extra unique index /
-- CHECK constraint / an outdated or erroring import RPC). These read-only
-- queries reveal the delegates table's real constraints and the live RPC
-- source so we can see why bulk inserts would drop rows.
-- ============================================================

-- 1) Every constraint/index on delegates (reveals any UNIQUE on phone,
--    external_id, or name columns that would reject bulk inserts).
SELECT i.relname AS index_name,
       ix.indisunique AS is_unique,
       pg_get_indexdef(ix.indexrelid) AS definition
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
WHERE t.relname = 'delegates'
ORDER BY ix.indisunique DESC, i.relname;

-- 2) Table CHECK / NOT NULL / defaults (see if e.g. last_name or district
--    has a CHECK that the import would violate).
SELECT a.attname AS column_name,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'delegates'::regclass
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum;

-- 3) The LIVE definition of the import RPC (is it the row-guard version, and
--    does it INSERT all rows or silently skip?).
SELECT pg_get_functiondef('import_delegates_batch_merge(JSONB, UUID)'::regprocedure)
AS import_rpc_source;

-- 4) The single existing "South East 2" row (to decide whether to keep/delete
--    before the clean re-import).
SELECT d.delegate_id, d.event_id, d.district, d.chapter, d.title,
       d.first_name, d.last_name, d.phone, d.email, d.registration_source
FROM delegates d
WHERE UPPER(TRIM(d.district)) IN ('SOUTH EAST 2', '')
ORDER BY d.created_at DESC LIMIT 20;
