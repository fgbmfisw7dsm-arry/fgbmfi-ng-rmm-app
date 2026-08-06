-- MIGRATION: Audit Log (v1.6)
-- Lightweight fire-and-forget audit trail for registrar/admin operations.
-- Every auditable action kicks off a background INSERT; never awaited.
-- Toggle: system_settings.audit_enabled (boolean). When false, zero overhead.

CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    event_id        UUID,
    action_type     TEXT NOT NULL,
    performed_by    UUID NOT NULL,
    performer_email TEXT,
    target_type     TEXT,
    target_id       TEXT,
    summary         TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_time ON audit_log(event_id, created_at DESC) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_system_time ON audit_log(created_at DESC) WHERE event_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_action_type ON audit_log(action_type);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'Allow insert for authenticated users'
    ) THEN
        CREATE POLICY "Allow insert for authenticated users" ON audit_log
            FOR INSERT TO authenticated WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'Allow select for admin users'
    ) THEN
        CREATE POLICY "Allow select for admin users" ON audit_log
            FOR SELECT TO authenticated
            USING (EXISTS (
                SELECT 1 FROM public.app_users
                WHERE id = auth.uid() AND role = 'admin'
            ));
    END IF;
END;
$$;
