-- MIGRATION: Ensure system_settings columns exist (titles/delegate_types/audit_enabled/updated_at)
-- Fixes: "Could not find the 'titles' column of 'system_settings' in the schema cache" (PGRST204)
-- Pre-check (run first to confirm which columns are missing):
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'system_settings';

ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS titles TEXT[] DEFAULT '{"Mr","Mrs","Ms","Chief","Dr","Prof","Engr","Elder"}';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS delegate_types TEXT[] DEFAULT '{"Member","National Guest","Free Guest","Dependant-Adult","Dependant-Teen","Dependant-Children","International"}';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS audit_enabled BOOLEAN DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Reload PostgREST schema cache (usually auto-triggered by the DDL event trigger; explicit here for safety)
NOTIFY pgrst, 'reload schema';
