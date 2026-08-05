-- FGBMFI Nigeria EMS — Sprint 16: Badge storage permanent fix
-- Purpose: Fix two storage issues:
--   1. Badges tab "Download" returned "404 Bucket not found" because the private
--      badge-pdfs bucket cannot serve /object/public/ URLs. The app now downloads
--      via the authenticated storage.download() API instead (no public URL needed).
--   2. Storage "Delete Selected" reported success but files remained because no
--      storage.objects DELETE policy existed for the authenticated role.
--
-- This migration is IDEMPOTENT (safe to re-run):
--   - Ensures the badge-pdfs bucket exists and stays PRIVATE
--   - Adds full storage RLS policies (SELECT/INSERT/UPDATE/DELETE) for the
--     authenticated role, scoped to the badge-pdfs bucket
--   - Adds a SELECT policy on storage.buckets so the client listBuckets() guard works
--
-- Deploy: Run in Supabase SQL Editor (postgres role).

-- 1. Ensure bucket exists (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('badge-pdfs', 'badge-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- 2. storage.objects policies for authenticated (scoped to badge-pdfs)
DROP POLICY IF EXISTS "auth_select_badge_pdfs" ON storage.objects;
CREATE POLICY "auth_select_badge_pdfs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'badge-pdfs');

DROP POLICY IF EXISTS "auth_insert_badge_pdfs" ON storage.objects;
CREATE POLICY "auth_insert_badge_pdfs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'badge-pdfs');

DROP POLICY IF EXISTS "auth_update_badge_pdfs" ON storage.objects;
CREATE POLICY "auth_update_badge_pdfs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'badge-pdfs')
  WITH CHECK (bucket_id = 'badge-pdfs');

DROP POLICY IF EXISTS "auth_delete_badge_pdfs" ON storage.objects;
CREATE POLICY "auth_delete_badge_pdfs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'badge-pdfs');

-- 3. storage.buckets SELECT for authenticated (listBuckets() client guard)
DROP POLICY IF EXISTS "auth_select_buckets" ON storage.buckets;
CREATE POLICY "auth_select_buckets"
  ON storage.buckets FOR SELECT
  TO authenticated
  USING (true);
