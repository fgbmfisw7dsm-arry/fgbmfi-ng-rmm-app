-- FGBMFI Nigeria EMS — External ID (CON26) Backfill
-- Purpose: Assign a proper CON26 registration number to any delegate whose
--   external_id is NULL, blank, or holds a non-CON26 value (legacy UUID
--   backfill from supabase_migration_convention.sql or reconcile inserts).
--   Badge surfaces fall back to an 8-char delegate_id slice when external_id
--   does not start with 'CON26', which is how truncated IDs like "d8bd8b8b"
--   appear on printed badges. This migration makes every delegate carry a real
--   CON26 reg number so badges print the full ID on every surface.
--
-- Format mirrors the client generateRegId(): 'CON26' + MMDDHHMMSS + 10 hex.
-- gen_random_uuid() supplies 32 hex chars per row so suffix collisions are
-- statistically impossible; no trigger/backstop is needed.
--
-- This migration is IDEMPOTENT (safe to re-run).
-- Deploy: Run in Supabase SQL Editor (postgres role).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE delegates
SET external_id = 'CON26' || to_char(now(), 'MMDDHH24MISS')
              || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 10)
WHERE external_id IS NULL
   OR btrim(external_id) = ''
   OR external_id NOT LIKE 'CON26%';

-- Sanity check: rows skipped because they already hold a CON26 reg number.
-- All delegates should now start with 'CON26'.
SELECT count(*) AS delegates_without_con26
FROM delegates
WHERE external_id IS NULL
   OR btrim(external_id) = ''
   OR external_id NOT LIKE 'CON26%';