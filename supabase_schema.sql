-- FGBMFI NIGERIA - REGIONAL EVENTS MANAGEMENT SYSTEM
-- MASTER DATABASE SCHEMA & RPC FUNCTIONS
-- INSTRUCTIONS: Copy this entire block and run it in the Supabase SQL Editor.
-- NOTE: This file is the COMPLETE schema as of Sprint 8 (July 2026).
--       Always run the FULL file on a fresh Supabase project.
--       For existing projects, run individual migration files in order.

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
    event_config JSONB DEFAULT '{}',
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
    delegate_type TEXT DEFAULT 'Member',
    qr_hash TEXT NOT NULL,
    event_id UUID REFERENCES events(event_id) ON DELETE SET NULL,
    external_id TEXT,
    registration_source TEXT DEFAULT 'import' CHECK (registration_source IN ('import', 'manual', 'qr_scan')),
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
    region TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT app_users_role_check CHECK (role IN (
      'national_admin','regional_admin','district_admin','admin',
      'national_registrar','regional_registrar','district_registrar','registrar',
      'finance'
    ))
);

CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    districts TEXT[] DEFAULT '{}',
    ranks TEXT[] DEFAULT '{}',
    offices TEXT[] DEFAULT '{}',
    regions TEXT[] DEFAULT '{"Lagos", "North West", "South South", "North Central", "South East", "South West"}',
    titles TEXT[] DEFAULT '{"Mr", "Mrs", "Ms", "Chief", "Dr", "Prof", "Engr", "Elder"}',
    delegate_types TEXT[] DEFAULT '{"Member","National Guest","Free Guest","Dependant-Adult","Dependant-Teen","Dependant-Children","International"}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deleted users tombstone table (for audit trail)
CREATE TABLE IF NOT EXISTS deleted_users (
    id UUID PRIMARY KEY,
    email TEXT,
    deleted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ADMINISTRATIVE RPC FUNCTIONS

-- 3a. Drop existing functions to ensure clean signature update
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS delete_app_user(TEXT);
DROP FUNCTION IF EXISTS delete_app_user(UUID);
DROP FUNCTION IF EXISTS reset_user_password(TEXT, TEXT);
DROP FUNCTION IF EXISTS reset_user_password(UUID, TEXT);
DROP FUNCTION IF EXISTS deactivate_app_user(TEXT);
DROP FUNCTION IF EXISTS reactivate_app_user(TEXT);
DROP FUNCTION IF EXISTS deactivate_all_event_users();

-- 3b. Create User Profile & Auth Account (Fix: removed instance_id, added identities insert)
-- GoTrue v2+ requires auth.identities record for signInWithPassword() to work.
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  new_user_id UUID;
BEGIN
  new_user_id := gen_random_uuid();
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
  VALUES (
    new_user_id,
    email,
    crypt(password, gen_salt('bf')),
    NOW(),
    jsonb_build_object('role', role, 'provider', 'email'),
    NOW(),
    NOW()
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    new_user_id,
    new_user_id,
    jsonb_build_object('sub', new_user_id, 'email', email),
    'email',
    NOW(),
    NOW(),
    NOW()
  );
  INSERT INTO public.app_users (id, email, role, district, region, is_active)
  VALUES (new_user_id, email, role, district, region, true);
  RETURN json_build_object('status', 'success', 'id', new_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3c. Delete User (Sprint 8 — with tombstone tracking)
CREATE OR REPLACE FUNCTION delete_app_user(user_id_to_delete TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_uid UUID;
  v_email TEXT;
BEGIN
  v_uid := user_id_to_delete::uuid;
  SELECT email INTO v_email FROM public.app_users WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  INSERT INTO public.deleted_users (id, email) VALUES (v_uid, v_email)
  ON CONFLICT (id) DO UPDATE SET deleted_at = NOW();
  DELETE FROM public.app_users WHERE id = v_uid;
  RETURN json_build_object('status', 'success', 'message', 'Account permanently removed');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3d. Reset Password (Sprint 8 — uses encrypted_password, explicit cast)
CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
  UPDATE auth.users SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE auth.users.id = user_id::uuid;
  RETURN json_build_object('status', 'success', 'message', 'Password updated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3e. Deactivate a single user (soft-delete)
CREATE OR REPLACE FUNCTION deactivate_app_user(user_id TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
  UPDATE public.app_users SET is_active = false WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account deactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3f. Reactivate a single user
CREATE OR REPLACE FUNCTION reactivate_app_user(user_id TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
  UPDATE public.app_users SET is_active = true WHERE id = user_id::uuid;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success', 'message', 'Account reactivated');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3g. Bulk deactivate all non-admin users
CREATE OR REPLACE FUNCTION deactivate_all_event_users()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_count INT;
BEGIN
  WITH updated AS (
    UPDATE public.app_users 
    SET is_active = false 
    WHERE is_active = true 
      AND role NOT IN ('national_admin', 'regional_admin', 'district_admin', 'admin')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  RETURN json_build_object(
    'status', 'success',
    'message', 'Bulk deactivation complete',
    'deactivated_count', v_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM);
END;
$func$;

-- 3h. Get Auth User Role (reads role from auth.users raw_app_meta_data as fallback)
CREATE OR REPLACE FUNCTION get_auth_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = auth.uid();
$func$;

-- 4. INITIAL SEED DATA
INSERT INTO system_settings (districts, ranks, offices, regions)
SELECT 
    '{"Lagos Central", "Abuja Central", "Rivers", "Kano", "Kaduna", "Enugu", "Edo", "Anambra"}',
    '{"CP", "FR", "ND", "CP-REP"}',
    '{"DC", "RVP", "NVP", "NP", "NEC", "BOT", "CP", "FR", "ND", "CP-REP", "OTHER"}',
    '{"Lagos", "North West", "South South", "North Central", "South East", "South West"}'
WHERE NOT EXISTS (SELECT 1 FROM system_settings);

-- 5. INDEXES (Performance — required for 25K scale)

-- GIN trigram indexes for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DROP INDEX IF EXISTS idx_delegates_name_gin;
CREATE INDEX idx_delegates_name_gin 
  ON delegates USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);

-- B-tree indexes
DROP INDEX IF EXISTS idx_delegates_phone;
CREATE INDEX idx_delegates_phone ON delegates(phone);
DROP INDEX IF EXISTS idx_checkins_event_delegate;
CREATE INDEX idx_checkins_event_delegate ON checkins(event_id, delegate_id);
DROP INDEX IF EXISTS idx_checkins_event_session;
CREATE INDEX idx_checkins_event_session ON checkins(event_id, session_id);
DROP INDEX IF EXISTS idx_financials_event;
CREATE INDEX idx_financials_event ON financial_entries(event_id);
DROP INDEX IF EXISTS idx_pledges_event;
CREATE INDEX idx_pledges_event ON pledges(event_id);
CREATE INDEX IF NOT EXISTS idx_delegates_event_id ON delegates(event_id);
CREATE INDEX IF NOT EXISTS idx_delegates_external_id ON delegates(external_id) WHERE external_id IS NOT NULL;

-- Unique indexes
DROP INDEX IF EXISTS idx_delegates_qr_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegates_qr_hash ON delegates(qr_hash);

-- 6. CHAPTERS TABLE (District-linked chapter registry)
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_code_unique ON chapters(chapter_code);

ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chapters_select" ON chapters;
CREATE POLICY "chapters_select" ON chapters FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "chapters_insert" ON chapters;
CREATE POLICY "chapters_insert" ON chapters FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "chapters_update" ON chapters;
CREATE POLICY "chapters_update" ON chapters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 7. AGGREGATE RPCs (Dashboard performance)

-- Dashboard stats: returns counts and aggregates for a single event
CREATE OR REPLACE FUNCTION get_event_dashboard_stats(p_event_id UUID, p_district TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  total_delegates BIGINT;
  total_checkins BIGINT;
  total_financials BIGINT;
  rank_counts JSON;
  district_counts JSON;
  recent_activity JSON;
  norm_district TEXT;
BEGIN
  norm_district := CASE WHEN p_district IS NOT NULL THEN UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g')) ELSE NULL END;

  IF norm_district IS NOT NULL THEN
    SELECT COUNT(*) INTO total_delegates FROM delegates
    WHERE UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = norm_district;
  ELSE
    SELECT COUNT(*) INTO total_delegates FROM delegates;
  END IF;

  SELECT COUNT(DISTINCT d.delegate_id) INTO total_checkins
  FROM checkins c
  JOIN delegates d ON c.delegate_id = d.delegate_id
  WHERE c.event_id = p_event_id
    AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district);

  SELECT COALESCE(SUM(amount), 0) INTO total_financials
  FROM financial_entries
  WHERE event_id = p_event_id;

  SELECT COALESCE(json_object_agg(rnk, cnt), '{}'::JSON) INTO rank_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER') AS rnk, COUNT(DISTINCT d.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
    GROUP BY COALESCE(NULLIF(TRIM(d.rank), ''), 'OTHER')
  ) sub;

  SELECT COALESCE(json_object_agg(distname, cnt), '{}'::JSON) INTO district_counts
  FROM (
    SELECT COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN') AS distname, COUNT(DISTINCT d.delegate_id) AS cnt
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
    GROUP BY COALESCE(NULLIF(TRIM(d.district), ''), 'UNKNOWN')
  ) sub;

  SELECT COALESCE(json_agg(activity), '[]'::JSON) INTO recent_activity
  FROM (
    SELECT
      c.checkin_id, c.event_id, c.delegate_id, c.session_id,
      c.checked_in_at, c.checked_in_by,
      d.first_name || ' ' || d.last_name AS delegate_name,
      COALESCE(d.district, 'Unknown') AS district,
      COALESCE(d.rank, '-') AS rank,
      COALESCE(d.office, '-') AS office
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
      AND (norm_district IS NULL OR UPPER(regexp_replace(TRIM(d.district), '\s+', ' ', 'g')) = norm_district)
    ORDER BY c.checked_in_at DESC
    LIMIT 10
  ) activity;

  RETURN json_build_object(
    'totalDelegates', total_delegates,
    'totalCheckIns', total_checkins,
    'totalFinancials', total_financials,
    'checkInsByRank', rank_counts,
    'checkInsByDistrict', district_counts,
    'recentActivity', recent_activity
  );
END;
$func$;

-- Paginated delegates query (for MasterListModule)
CREATE OR REPLACE FUNCTION get_paginated_delegates(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_district TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  total_count BIGINT;
  results JSON;
  offset_val INTEGER;
BEGIN
  offset_val := (p_page - 1) * p_page_size;

  SELECT COUNT(*) INTO total_count FROM delegates
  WHERE (
    p_search IS NULL OR
    first_name ILIKE '%' || p_search || '%' OR
    last_name ILIKE '%' || p_search || '%' OR
    phone ILIKE '%' || p_search || '%' OR
    email ILIKE '%' || p_search || '%' OR
    chapter ILIKE '%' || p_search || '%'
  )
  AND (
    p_district IS NULL OR
    UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g'))
  );

  SELECT COALESCE(json_agg(delegate_rows), '[]'::JSON) INTO results
  FROM (
    SELECT * FROM delegates
    WHERE (
      p_search IS NULL OR
      first_name ILIKE '%' || p_search || '%' OR
      last_name ILIKE '%' || p_search || '%' OR
      phone ILIKE '%' || p_search || '%' OR
      email ILIKE '%' || p_search || '%' OR
      chapter ILIKE '%' || p_search || '%'
    )
    AND (
      p_district IS NULL OR
      UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')) = UPPER(regexp_replace(TRIM(p_district), '\s+', ' ', 'g'))
    )
    ORDER BY first_name, last_name
    LIMIT p_page_size
    OFFSET offset_val
  ) delegate_rows;

  RETURN json_build_object(
    'data', results,
    'total', total_count,
    'page', p_page,
    'pageSize', p_page_size,
    'totalPages', CEIL(total_count::FLOAT / p_page_size)
  );
END;
$func$;

-- Export data RPC (replaces client-side getAllDataForExport)
CREATE OR REPLACE FUNCTION get_event_export_data(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  delegates_json JSON;
  checkins_json JSON;
  financials_json JSON;
  pledges_json JSON;
BEGIN
  SELECT COALESCE(json_agg(d), '[]'::JSON) INTO delegates_json
  FROM (
    SELECT delegate_id, title, first_name, last_name, district, chapter, phone, email, rank, office, room_number, created_at
    FROM delegates
    ORDER BY first_name, last_name
  ) d;

  SELECT COALESCE(json_agg(c), '[]'::JSON) INTO checkins_json
  FROM (
    SELECT c.*, d.first_name || ' ' || d.last_name AS delegate_name, d.district, d.rank, d.office
    FROM checkins c
    JOIN delegates d ON c.delegate_id = d.delegate_id
    WHERE c.event_id = p_event_id
    ORDER BY c.checked_in_at
  ) c;

  SELECT COALESCE(json_agg(f), '[]'::JSON) INTO financials_json
  FROM (
    SELECT * FROM financial_entries
    WHERE event_id = p_event_id
    ORDER BY created_at
  ) f;

  SELECT COALESCE(json_agg(p), '[]'::JSON) INTO pledges_json
  FROM (
    SELECT * FROM pledges
    WHERE event_id = p_event_id
    ORDER BY created_at
  ) p;

  RETURN json_build_object(
    'delegates', delegates_json,
    'checkins', checkins_json,
    'financials', financials_json,
    'pledges', pledges_json
  );
END;
$func$;

-- Bulk import delegates with deduplication
CREATE OR REPLACE FUNCTION import_delegates_batch(p_delegates JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_inserted INT := 0;
  v_skipped INT := 0;
  v_item JSONB;
BEGIN
  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_delegates)
  LOOP
    IF EXISTS (
      SELECT 1 FROM delegates 
      WHERE UPPER(TRIM(first_name)) = UPPER(TRIM(v_item->>'first_name'))
        AND UPPER(TRIM(last_name)) = UPPER(TRIM(v_item->>'last_name'))
        AND COALESCE(phone, '') = COALESCE(TRIM(v_item->>'phone'), '')
    ) THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO delegates (
        title, first_name, last_name, district, chapter,
        phone, email, rank, office, qr_hash, event_id, registration_source
      ) VALUES (
        COALESCE(v_item->>'title', 'Mr'),
        TRIM(v_item->>'first_name'),
        TRIM(v_item->>'last_name'),
        TRIM(v_item->>'district'),
        TRIM(v_item->>'chapter'),
        TRIM(v_item->>'phone'),
        LOWER(TRIM(v_item->>'email')),
        COALESCE(v_item->>'rank', 'CP'),
        COALESCE(v_item->>'office', 'OTHER'),
        COALESCE(v_item->>'qr_hash', gen_random_uuid()::TEXT),
        v_item->>'event_id',
        COALESCE(v_item->>'registration_source', 'import')
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'total', v_inserted + v_skipped
  );
END;
$func$;

-- 8. ROW-LEVEL SECURITY (RLS) POLICIES

-- 8a. Helper: Check if current user has admin role
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role IN ('national_admin','regional_admin','district_admin','admin')
      AND (is_active IS NULL OR is_active = true)
  );
$func$;

-- 8b. Helper: Get current user's district (for registrar scoping)
CREATE OR REPLACE FUNCTION current_user_district()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $func$
  SELECT district FROM app_users
  WHERE id = auth.uid()
    AND (is_active IS NULL OR is_active = true)
  LIMIT 1;
$func$;

-- 8c. Enable RLS on all tables
ALTER TABLE events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pledges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings  ENABLE ROW LEVEL SECURITY;

-- 8d. Drop existing policies (preserve chapters)
DO $$ DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public')
  LOOP
    IF r.tablename != 'chapters' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END IF;
  END LOOP;
END $$;

-- 8e. app_users policies
CREATE POLICY "app_users_view_own" ON app_users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "app_users_admin_view_all" ON app_users FOR SELECT TO authenticated USING (is_admin_user());
CREATE POLICY "app_users_insert_own" ON app_users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "app_users_admin_update" ON app_users FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "app_users_admin_delete" ON app_users FOR DELETE TO authenticated USING (is_admin_user());

-- 8f. events policies
CREATE POLICY "events_select_all" ON events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_admin_insert" ON events FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "events_admin_update" ON events FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "events_admin_delete" ON events FOR DELETE TO authenticated USING (is_admin_user());

-- 8g. delegates policies
CREATE POLICY "delegates_select_all" ON delegates FOR SELECT TO authenticated USING (true);
CREATE POLICY "delegates_insert_scoped" ON delegates FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL));
CREATE POLICY "delegates_update_scoped" ON delegates FOR UPDATE TO authenticated
    USING (is_admin_user() OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL))
    WITH CHECK (is_admin_user() OR (district ILIKE COALESCE(current_user_district(), '') AND current_user_district() IS NOT NULL));
CREATE POLICY "delegates_admin_delete" ON delegates FOR DELETE TO authenticated USING (is_admin_user());

-- 8h. sessions policies
CREATE POLICY "sessions_select_all" ON sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_admin_insert" ON sessions FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "sessions_admin_update" ON sessions FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "sessions_admin_delete" ON sessions FOR DELETE TO authenticated USING (is_admin_user());

-- 8i. checkins policies
CREATE POLICY "checkins_select_all" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "checkins_admin_registrar_insert" ON checkins FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR EXISTS (
      SELECT 1 FROM app_users
      WHERE id = auth.uid()
        AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
        AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "checkins_admin_update" ON checkins FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());
CREATE POLICY "checkins_admin_delete" ON checkins FOR DELETE TO authenticated USING (is_admin_user());

-- 8j. pledges policies
CREATE POLICY "pledges_select_all" ON pledges FOR SELECT TO authenticated USING (true);
CREATE POLICY "pledges_admin_finance_insert" ON pledges FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "pledges_admin_finance_update" ON pledges FOR UPDATE TO authenticated
    USING (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)))
    WITH CHECK (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "pledges_admin_delete" ON pledges FOR DELETE TO authenticated USING (is_admin_user());

-- 8k. financial_entries policies
CREATE POLICY "financials_select_all" ON financial_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "financials_admin_finance_insert" ON financial_entries FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "financials_admin_finance_update" ON financial_entries FOR UPDATE TO authenticated
    USING (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)))
    WITH CHECK (is_admin_user() OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
CREATE POLICY "financials_admin_delete" ON financial_entries FOR DELETE TO authenticated USING (is_admin_user());

-- 8l. system_settings policies
CREATE POLICY "settings_select_all" ON system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_admin_insert" ON system_settings FOR INSERT TO authenticated WITH CHECK (is_admin_user());
CREATE POLICY "settings_admin_update" ON system_settings FOR UPDATE TO authenticated USING (is_admin_user()) WITH CHECK (is_admin_user());