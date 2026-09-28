-- FGBMFI Nigeria EMS — Badge Fee Category + A6 Single Layout
-- Purpose: (1) Track the EARLY BIRD / REGULAR fee-category stamp chosen for each
--   batch so Batches / Reprint / History always reproduce the correct stamp,
--   and (2) allow the badge_batches`a6-single` layout (1 badge per A6 page,
--   100x140mm content on 105x148mm pre-cut shell paper for venue desk printing).
--
--   - badge_batches.fee_category : 'early_bird' | 'regular', NOT NULL DEFAULT
--       'early_bird' (every historical batch was printed during the Early Bird
--       window, so the default matches reality). The Badge Printing page toggle
--       controls this; Reprint regenerates using the stored value.
--   - badge_batches layout CHECK widened to include 'a6-single'.
--
-- IDEMPOTENT — safe to re-run (deploy in Supabase SQL Editor; postgres role).
-- Deploy order: run this PLUS supabase_migration_exec_registrar.sql BEFORE the
-- frontend build, because the frontend inserts these columns/values.

ALTER TABLE badge_batches ADD COLUMN IF NOT EXISTS fee_category TEXT NOT NULL DEFAULT 'early_bird';
ALTER TABLE badge_batches DROP CONSTRAINT IF EXISTS badge_batches_fee_category_check;
ALTER TABLE badge_batches ADD CONSTRAINT badge_batches_fee_category_check
  CHECK (fee_category IN ('early_bird', 'regular'));

ALTER TABLE badge_batches DROP CONSTRAINT IF EXISTS badge_batches_layout_check;
ALTER TABLE badge_batches ADD CONSTRAINT badge_batches_layout_check
  CHECK (layout IN ('8-up', '10-up', '6-up-portrait', '9-up-portrait', '8-up-portrait', '4-up-3x4', '4-up-portrait', 'a6-single'));

CREATE INDEX IF NOT EXISTS idx_badge_batches_event_fee ON badge_batches(event_id, fee_category);