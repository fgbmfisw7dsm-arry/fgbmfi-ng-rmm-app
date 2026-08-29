-- FGBMFI Nigeria EMS — Badge Printed Status
-- Purpose: Track per-delegate "Badge Printed" status so the Badge Printing module can
--   skip already-printed badges during reprints and support staged generation
--   (generate some batches → download → mark printed → delete → continue).
--
--   - delegates.badge_printed    : boolean, false by default; set true when the batch
--                                  containing the delegate is marked "Printed".
--   - delegates.badge_printed_at : timestamp of the mark-printed action.
--   - idx_delegates_badge_printed: index backing the 25K-scale "Not Printed" filter
--                                  used by getFilteredDelegates/getFilteredDelegateCount.
--
-- This migration is IDEMPOTENT (safe to re-run).
-- Deploy: Run in Supabase SQL Editor (postgres role).
--
-- RLS: no policy changes required. Badge Printing is admin + event_admin only, and both
--   roles already hold delegates UPDATE via existing RLS policies.

ALTER TABLE delegates ADD COLUMN IF NOT EXISTS badge_printed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS badge_printed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_delegates_badge_printed ON delegates(event_id, badge_printed);