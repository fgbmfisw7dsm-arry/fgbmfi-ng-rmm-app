-- MIGRATION: Event Admin Financials access (v1.8)
-- Grants event_admin finance-level write access (insert/update) on pledges and
-- financial_entries. Delete remains admin-only (least privilege).

-- pledges: insert + update (add event admin)
DROP POLICY IF EXISTS "pledges_admin_finance_insert" ON pledges;
CREATE POLICY "pledges_admin_finance_insert" ON pledges FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR is_event_admin_user()
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "pledges_admin_finance_update" ON pledges;
CREATE POLICY "pledges_admin_finance_update" ON pledges FOR UPDATE TO authenticated
    USING (is_admin_user() OR is_event_admin_user()
        OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)))
    WITH CHECK (is_admin_user() OR is_event_admin_user()
        OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));

-- financial_entries: insert + update (add event admin)
DROP POLICY IF EXISTS "financials_admin_finance_insert" ON financial_entries;
CREATE POLICY "financials_admin_finance_insert" ON financial_entries FOR INSERT TO authenticated WITH CHECK (
    is_admin_user() OR is_event_admin_user()
    OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "financials_admin_finance_update" ON financial_entries;
CREATE POLICY "financials_admin_finance_update" ON financial_entries FOR UPDATE TO authenticated
    USING (is_admin_user() OR is_event_admin_user()
        OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)))
    WITH CHECK (is_admin_user() OR is_event_admin_user()
        OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('finance') AND (is_active IS NULL OR is_active = true)));
