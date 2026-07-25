-- Sprint 5: Supabase Pro Tier Verification & Connection Pool Monitoring

-- ============================================================
-- 1. VERIFY CONNECTION POOL STATUS
-- Run this in Supabase SQL Editor to check current utilization
-- ============================================================

SELECT 
  datname AS database,
  numbackends AS active_connections,
  xact_commit AS transactions_committed,
  xact_rollback AS transactions_rolled_back,
  blks_read,
  blks_hit,
  blks_hit * 100.0 / NULLIF(blks_hit + blks_read, 0) AS cache_hit_ratio_pct
FROM pg_stat_database
WHERE datname = 'postgres';


-- ============================================================
-- 2. MONITOR QUERY PERFORMANCE
-- Check slow queries (useful during load testing)
-- ============================================================

SELECT 
  query,
  calls,
  total_exec_time / 1000 AS total_seconds,
  mean_exec_time AS avg_ms,
  max_exec_time AS max_ms,
  rows
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%'
ORDER BY total_exec_time DESC
LIMIT 10;


-- ============================================================
-- 3. PRO TIER BENEFITS (After Upgrade)
-- ============================================================
-- - Connections: 15 (Free) → 60 (Pro)
-- - DB Size: 500MB (Free) → 8GB (Pro)
-- - Bandwidth: 2GB (Free) → 50GB (Pro)
-- - Projects: 2 (Free) → Unlimited (Pro)
-- - Daily backups: Manual only (Free) → Automatic (Pro)
-- - Audit logs: Not available (Free) → Available (Pro)
-- - Realtime messages: 2M (Free) → 5M (Pro)


-- ============================================================
-- 4. RECOMMENDED INDEXES (Verify after upgrades)
-- ============================================================
-- pg_trgm extension for text search (should already exist from Sprint 1)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Verify existing indexes
SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('delegates', 'checkins', 'financial_entries', 'pledges')
ORDER BY tablename, indexname;
