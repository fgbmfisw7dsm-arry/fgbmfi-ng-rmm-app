-- FGBMFI NIGERIA - REGIONAL EVENTS MANAGEMENT SYSTEM
-- MASTER DATABASE SCHEMA & RPC FUNCTIONS
-- INSTRUCTIONS: Copy this entire block and run it in the Supabase SQL Editor.

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CORE TABLES
CREATE TABLE IF NOT EXISTS events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    region TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delegates (
    delegate_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    district TEXT NOT NULL,
    chapter TEXT,
    phone TEXT,
    email TEXT,
    rank TEXT DEFAULT 'CP',
    office TEXT DEFAULT 'OTHER',
    room_number TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
    checkin_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    delegate_id UUID REFERENCES delegates(delegate_id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
    checked_in_at TIMESTAMPTZ DEFAULT NOW(),
    checked_in_by UUID
);

CREATE TABLE IF NOT EXISTS pledges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    donor_name TEXT NOT NULL,
    district TEXT NOT NULL,
    chapter TEXT,
    phone TEXT,
    email TEXT,
    amount_pledged DECIMAL(15,2) DEFAULT 0,
    amount_redeemed DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_entries (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(event_id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(session_id) ON DELETE CASCADE,
    pledge_id UUID REFERENCES pledges(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    type TEXT NOT NULL,
    payer_name TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'registrar',
    district TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    districts TEXT[] DEFAULT '{}',
    ranks TEXT[] DEFAULT '{}',
    offices TEXT[] DEFAULT '{}',
    regions TEXT[] DEFAULT '{"Lagos", "North West", "South South", "North Central", "South East", "South West"}',
    titles TEXT[] DEFAULT '{"Mr", "Mrs", "Ms", "Chief", "Dr", "Prof", "Engr", "Elder"}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ADMINISTRATIVE RPC FUNCTIONS (The fix for the Deletion error)

-- 3a. Drop existing functions to ensure clean signature update
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS delete_app_user(TEXT);
DROP FUNCTION IF EXISTS reset_user_password(TEXT, TEXT);

-- 3b. Create User Profile & Auth Account
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  new_user_id UUID;
BEGIN
  -- Insert into Supabase Auth schema
  INSERT INTO auth.users (email, password, email_confirmed_at, raw_app_meta_data)
  VALUES (email, crypt(password, gen_salt('bf')), NOW(), jsonb_build_object('role', role))
  RETURNING id INTO new_user_id;

  -- Insert into public profile table
  INSERT INTO public.app_users (id, email, role, district)
  VALUES (new_user_id, email, role, district);

  RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3c. Delete User (FIXED: Explicit ::uuid casting)
CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT)
RETURNS JSON AS $$
BEGIN
  -- Perform deletion using explicit cast to resolve 'text = uuid' mismatch
  DELETE FROM auth.users WHERE auth.users.id = user_id_to_delete::uuid;
  
  -- app_users table will delete automatically via FK CASCADE
  RETURN json_build_object('status', 'success', 'message', 'Account deleted');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3d. Reset Password (FIXED: Explicit ::uuid casting)
CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON AS $$
BEGIN
  -- Update auth record using explicit cast to resolve 'text = uuid' mismatch
  UPDATE auth.users 
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE auth.users.id = user_id::uuid;
  
  RETURN json_build_object('status', 'success', 'message', 'Password updated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. INITIAL SEED DATA
INSERT INTO system_settings (districts, ranks, offices, regions)
SELECT 
    '{"Lagos Central", "Abuja Central", "Rivers", "Kano", "Kaduna", "Enugu", "Edo", "Anambra"}',
    '{"CP", "FR", "ND", "CP-REP"}',
    '{"DC", "RVP", "NVP", "NP", "NEC", "BOT", "CP", "FR", "ND", "CP-REP", "OTHER"}',
    '{"Lagos", "North West", "South South", "North Central", "South East", "South West"}'
WHERE NOT EXISTS (SELECT 1 FROM system_settings);

-- 5. v1.2 MIGRATION — Delegate Types, Event Config, Chapters
-- Run this section to upgrade an existing v1.1 database

-- 5a. Add delegate_type to delegates
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS delegate_type TEXT DEFAULT 'Member';

-- 5b. Add event_config to events (per-event field visibility overrides)
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_config JSONB DEFAULT '{}';

-- 5c. Add delegate_types list to system_settings
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS delegate_types TEXT[] DEFAULT '{"Member","National Guest","Free Guest","Dependant-Adult","Dependant-Teen","Dependant-Children","International"}';

-- 5d. Seed delegate_types into existing system_settings row
UPDATE system_settings 
SET delegate_types = COALESCE(delegate_types, '{"Member","National Guest","Free Guest","Dependant-Adult","Dependant-Teen","Dependant-Children","International"}')
WHERE delegate_types IS NULL;

-- 5e. Chapters table (district-linked chapter registry)
CREATE TABLE IF NOT EXISTS chapters (
    chapter_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    district TEXT NOT NULL,
    chapter_code TEXT,
    chapter_name TEXT NOT NULL,
    state TEXT,
    city TEXT,
    meeting_day TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chapters_district ON chapters(district);

-- 5f. Unique index on chapter_code (required for upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_code_unique ON chapters(chapter_code);

-- 5g. RLS for chapters (authenticated users can read/write)
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chapters_select" ON chapters;
CREATE POLICY "chapters_select" ON chapters FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "chapters_insert" ON chapters;
CREATE POLICY "chapters_insert" ON chapters FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "chapters_update" ON chapters;
CREATE POLICY "chapters_update" ON chapters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);