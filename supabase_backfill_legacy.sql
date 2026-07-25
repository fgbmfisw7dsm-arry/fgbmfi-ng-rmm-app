-- ============================================================
-- FGBMFI Nigeria EMS — Backfill: Isolate Past Delegates
-- Run this in Supabase SQL Editor AFTER creating a legacy event
-- ============================================================

-- Step 1: Create a "Legacy / Past Events" record if not exists
INSERT INTO events (event_id, name, region, start_date, end_date, is_active)
SELECT 
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Legacy / Past Events',
  'All Regions',
  '2023-01-01',
  '2023-12-31',
  false
WHERE NOT EXISTS (SELECT 1 FROM events WHERE event_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Step 2: Backfill all orphan delegates (event_id IS NULL) to the legacy event
UPDATE delegates 
SET event_id = '00000000-0000-0000-0000-000000000001'::uuid 
WHERE event_id IS NULL;

-- Step 3: Verify
SELECT 
  'Backfilled' AS status,
  COUNT(*) AS orphan_delegates_reassigned
FROM delegates 
WHERE event_id = '00000000-0000-0000-0000-000000000001'::uuid;
