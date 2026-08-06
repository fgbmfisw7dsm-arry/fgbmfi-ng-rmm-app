-- MIGRATION: Add audit_enabled column to system_settings (v1.6)
-- Fixes: audit toggle in SetupModule was permanently stuck ON because
-- the column didn't exist in the DB. UPDATE payload silently dropped it.

ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS audit_enabled BOOLEAN DEFAULT true;
