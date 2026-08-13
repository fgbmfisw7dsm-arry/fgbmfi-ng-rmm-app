-- MIGRATION: Audit Log admin access fix + clear support (v1.8)
-- Fixes: SELECT policy only allowed role='admin' (blocking national/regional/district admins).
-- Adds: DELETE policy for admins (clear-by-period) + created_at index for range deletes/counts.

-- 1. Recreate SELECT policy to cover all admin roles
DROP POLICY IF EXISTS "Allow select for admin users" ON audit_log;
CREATE POLICY "Allow select for admin users" ON audit_log
    FOR SELECT TO authenticated
    USING (is_admin_user());

-- 2. Add DELETE policy for admins (clear-by-period)
DROP POLICY IF EXISTS "Allow delete for admin users" ON audit_log;
CREATE POLICY "Allow delete for admin users" ON audit_log
    FOR DELETE TO authenticated
    USING (is_admin_user());

-- 3. Index for date-range delete/count efficiency
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);
