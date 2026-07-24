-- ============================================================
-- FGBMFI Nigeria EMS — Sprint 2: QR UUID Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add qr_hash column (nullable initially for existing records)
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS qr_hash TEXT;

-- 2. Add unique constraint (will be validated after backfill)
-- Drop existing if somehow leftover from a previous attempt
ALTER TABLE delegates DROP CONSTRAINT IF EXISTS delegates_qr_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_qr_hash_unique ON delegates(qr_hash) WHERE qr_hash IS NOT NULL;

-- 3. Generate UUIDs for all existing records that don't have one
UPDATE delegates 
SET qr_hash = gen_random_uuid()::TEXT 
WHERE qr_hash IS NULL;

-- 4. Now make it NOT NULL since all records are backfilled
ALTER TABLE delegates ALTER COLUMN qr_hash SET NOT NULL;

-- 5. Drop the partial index and create a standard unique index
DROP INDEX IF EXISTS idx_delegates_qr_hash_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_qr_hash ON delegates(qr_hash);

-- 6. B-tree index for fast QR lookups (already covered by UNIQUE index)

-- 7. Verify the migration
SELECT 
  COUNT(*) AS total_delegates,
  COUNT(qr_hash) AS with_qr_hash,
  COUNT(DISTINCT qr_hash) AS unique_qr_hashes
FROM delegates;
