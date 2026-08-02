-- ============================================================
-- Migration: Add 8-up-portrait layout to badge_batches constraint
-- ============================================================

ALTER TABLE badge_batches DROP CONSTRAINT IF EXISTS badge_batches_layout_check;

ALTER TABLE badge_batches ADD CONSTRAINT badge_batches_layout_check
  CHECK (layout IN ('8-up', '10-up', '6-up-portrait', '9-up-portrait', '8-up-portrait'));
