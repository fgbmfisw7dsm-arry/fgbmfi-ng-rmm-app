-- FGBMFI Nigeria - Convention Accreditation Migration
-- Adds event-scoped delegates, external ID support, and registration tracking

-- Phase 1: Add columns to delegates table
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(event_id) ON DELETE SET NULL;
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS registration_source TEXT DEFAULT 'import' CHECK (registration_source IN ('import', 'manual', 'qr_scan'));

-- Phase 2: Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_delegates_event_id ON delegates(event_id);
CREATE INDEX IF NOT EXISTS idx_delegates_external_id ON delegates(external_id) WHERE external_id IS NOT NULL;

-- Phase 3: Backfill existing delegates with a UUID-based external_id for compatibility
-- Only affects rows where external_id is still NULL
UPDATE delegates SET external_id = delegate_id WHERE external_id IS NULL;

-- Phase 4: Update RLS policies to include event_id scoping
-- (Run in Supabase SQL Editor alongside existing policies)

-- Note: The searchDelegates function should be updated to filter by event_id
-- This migration adds the column; the application code handles the query changes
