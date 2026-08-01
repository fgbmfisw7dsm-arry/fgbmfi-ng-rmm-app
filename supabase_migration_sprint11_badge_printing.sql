-- ============================================================
-- Sprint 11: Badge Printing Module
-- Tables: badge_batches, badge_print_logs
-- Storage Bucket: badge-pdfs
-- ============================================================

-- 1. Badge Batches Table
CREATE TABLE IF NOT EXISTS badge_batches (
  batch_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  batch_number INT NOT NULL,
  badge_count INT NOT NULL DEFAULT 0,
  page_count INT NOT NULL DEFAULT 0,
  layout TEXT NOT NULL DEFAULT '8-up' CHECK (layout IN ('8-up', '10-up')),
  sort_field TEXT NOT NULL DEFAULT 'surname',
  filters JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'printing', 'printed', 'failed')),
  pdf_url TEXT,
  generated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_badge_batches_event ON badge_batches(event_id);
CREATE INDEX idx_badge_batches_status ON badge_batches(status);
CREATE INDEX idx_badge_batches_batch_number ON badge_batches(event_id, batch_number);

-- 2. Badge Print Logs Table (Audit Trail)
CREATE TABLE IF NOT EXISTS badge_print_logs (
  log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES badge_batches(batch_id) ON DELETE SET NULL,
  event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  delegate_id UUID NOT NULL REFERENCES delegates(delegate_id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('generated', 'reprinted', 'replaced_lost')),
  performed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_badge_print_logs_event ON badge_print_logs(event_id);
CREATE INDEX idx_badge_print_logs_delegate ON badge_print_logs(delegate_id);
CREATE INDEX idx_badge_print_logs_batch ON badge_print_logs(batch_id);
CREATE INDEX idx_badge_print_logs_created ON badge_print_logs(created_at);

-- 3. RLS: Badge Batches
ALTER TABLE badge_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view badge batches"
  ON badge_batches FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert badge batches"
  ON badge_batches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin', 'national_registrar', 'regional_registrar')
    )
  );

CREATE POLICY "Admin can update badge batches"
  ON badge_batches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin', 'national_registrar', 'regional_registrar')
    )
  );

CREATE POLICY "Admin can delete badge batches"
  ON badge_batches FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin')
    )
  );

-- 4. RLS: Badge Print Logs
ALTER TABLE badge_print_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view print logs"
  ON badge_print_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin and registrar can insert print logs"
  ON badge_print_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin', 'national_registrar', 'regional_registrar', 'district_registrar', 'registrar')
    )
  );

CREATE POLICY "Admin can delete print logs"
  ON badge_print_logs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin')
    )
  );

-- 5. RPC: Get batch number sequence for an event
CREATE OR REPLACE FUNCTION get_next_batch_number(p_event_id UUID)
RETURNS INT AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(batch_number), 0) + 1 INTO next_num
  FROM badge_batches
  WHERE event_id = p_event_id;
  RETURN next_num;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. RPC: Count filtered delegates for badge generation
CREATE OR REPLACE FUNCTION get_filtered_delegate_count(
  p_event_id UUID,
  p_district TEXT DEFAULT NULL,
  p_chapter TEXT DEFAULT NULL,
  p_delegate_type TEXT DEFAULT NULL,
  p_registration_status TEXT DEFAULT NULL,
  p_name_from TEXT DEFAULT NULL,
  p_name_to TEXT DEFAULT NULL,
  p_external_from TEXT DEFAULT NULL,
  p_external_to TEXT DEFAULT NULL,
  p_selected_ids TEXT[] DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM delegates d
  WHERE d.event_id = p_event_id
    AND (p_district IS NULL OR d.district ILIKE '%' || p_district || '%')
    AND (p_chapter IS NULL OR d.chapter ILIKE '%' || p_chapter || '%')
    AND (p_delegate_type IS NULL OR d.delegate_type = p_delegate_type)
    AND (p_name_from IS NULL OR UPPER(d.last_name) >= UPPER(p_name_from))
    AND (p_name_to IS NULL OR UPPER(d.last_name) <= UPPER(p_name_to))
    AND (p_external_from IS NULL OR d.external_id >= p_external_from)
    AND (p_external_to IS NULL OR d.external_id <= p_external_to)
    AND (p_selected_ids IS NULL OR d.delegate_id = ANY(p_selected_ids))
    AND (
      p_registration_status IS NULL OR p_registration_status = 'all'
      OR (
        p_registration_status = 'checked_in'
        AND EXISTS (SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id AND c.event_id = p_event_id)
      )
      OR (
        p_registration_status = 'not_checked_in'
        AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id AND c.event_id = p_event_id)
      )
    );
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC: Get filtered delegates (paginated, for badge generation)
CREATE OR REPLACE FUNCTION get_filtered_delegates(
  p_event_id UUID,
  p_district TEXT DEFAULT NULL,
  p_chapter TEXT DEFAULT NULL,
  p_delegate_type TEXT DEFAULT NULL,
  p_registration_status TEXT DEFAULT NULL,
  p_name_from TEXT DEFAULT NULL,
  p_name_to TEXT DEFAULT NULL,
  p_external_from TEXT DEFAULT NULL,
  p_external_to TEXT DEFAULT NULL,
  p_selected_ids TEXT[] DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'surname',
  p_limit INT DEFAULT 500,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  delegate_id UUID,
  title TEXT,
  first_name TEXT,
  last_name TEXT,
  district TEXT,
  chapter TEXT,
  phone TEXT,
  email TEXT,
  rank TEXT,
  office TEXT,
  delegate_type TEXT,
  qr_hash TEXT,
  external_id TEXT,
  event_id UUID,
  registration_source TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT d.delegate_id, d.title, d.first_name, d.last_name,
         d.district, d.chapter, d.phone, d.email,
         d.rank, d.office, d.delegate_type,
         d.qr_hash, d.external_id, d.event_id,
         d.registration_source, d.created_at
  FROM delegates d
  WHERE d.event_id = p_event_id
    AND (p_district IS NULL OR d.district ILIKE '%' || p_district || '%')
    AND (p_chapter IS NULL OR d.chapter ILIKE '%' || p_chapter || '%')
    AND (p_delegate_type IS NULL OR d.delegate_type = p_delegate_type)
    AND (p_name_from IS NULL OR UPPER(d.last_name) >= UPPER(p_name_from))
    AND (p_name_to IS NULL OR UPPER(d.last_name) <= UPPER(p_name_to))
    AND (p_external_from IS NULL OR d.external_id >= p_external_from)
    AND (p_external_to IS NULL OR d.external_id <= p_external_to)
    AND (p_selected_ids IS NULL OR d.delegate_id = ANY(p_selected_ids))
    AND (
      p_registration_status IS NULL OR p_registration_status = 'all'
      OR (
        p_registration_status = 'checked_in'
        AND EXISTS (SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id AND c.event_id = p_event_id)
      )
      OR (
        p_registration_status = 'not_checked_in'
        AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.delegate_id = d.delegate_id AND c.event_id = p_event_id)
      )
    )
  ORDER BY
    CASE WHEN p_sort_by = 'delegate_number' THEN d.external_id END,
    CASE WHEN p_sort_by = 'surname' THEN UPPER(d.last_name) END,
    CASE WHEN p_sort_by = 'district' THEN UPPER(d.district) END,
    CASE WHEN p_sort_by = 'chapter' THEN UPPER(d.chapter) END,
    CASE WHEN p_sort_by = 'category' THEN UPPER(d.delegate_type) END,
    CASE WHEN p_sort_by = 'registration_date' THEN d.created_at::TEXT END,
    UPPER(d.last_name)
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Storage bucket for badge PDFs
-- Run this in Supabase SQL Editor or via Storage UI:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('badge-pdfs', 'badge-pdfs', false);
