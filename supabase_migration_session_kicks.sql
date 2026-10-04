-- =================================================================================
-- v1.73 — Connected Users Monitor: admin-issued session kicks
-- =================================================================================
-- Idempotent. Deploy in the Supabase SQL editor BEFORE the frontend.
--
-- Backs the "Disconnect" action on the Connected Users page. The live list itself
-- uses Supabase Realtime Presence (no schema). A kick row is a durable, RLS-gated
-- signal that a signed-in client reads (Realtime INSERT + boot check) and honors
-- by signing itself out locally (scope: 'local').
--
--   device_id IS NULL  -> disconnect ALL devices on that shared login
--   device_id = <value> -> disconnect only that device (fgbmfi_device_id)
--
-- Cooperative by design: RLS prevents forgery/non-admin issuance; the target
-- client performs the actual local sign-out.
-- =================================================================================

create table if not exists public.session_kicks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.app_users(id) on delete cascade,
  device_id     text,
  issued_by     uuid,
  issued_email  text,
  reason        text,
  created_at    timestamptz not null default now(),
  consumed_at   timestamptz
);

create index if not exists idx_session_kicks_user_pending
  on public.session_kicks (user_id)
  where consumed_at is null;

create index if not exists idx_session_kicks_created_at
  on public.session_kicks (created_at desc);

alter table public.session_kicks enable row level security;

-- Issuance: administrators only (is_admin_user() = national/regional/district/admin).
drop policy if exists session_kicks_insert_admin on public.session_kicks;
create policy session_kicks_insert_admin on public.session_kicks
  for insert to authenticated
  with check (is_admin_user());

-- Reads: admins can review all; a user can read their own kicks (drives the
-- Realtime postgres_changes subscription filtered by user_id=eq.<self>).
drop policy if exists session_kicks_select_scoped on public.session_kicks;
create policy session_kicks_select_scoped on public.session_kicks
  for select to authenticated
  using (is_admin_user() or user_id = auth.uid());

-- Consumption: a user may mark their own kicks consumed.
drop policy if exists session_kicks_consume_own on public.session_kicks;
create policy session_kicks_consume_own on public.session_kicks
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Realtime: publish so a connected client self-disconnects immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'session_kicks'
  ) then
    alter publication supabase_realtime add table public.session_kicks;
  end if;
end $$;

-- Optional retention: remove consumed kicks older than 30 days.
-- Run manually or schedule with pg_cron if enabled.
-- delete from public.session_kicks where consumed_at is not null and consumed_at < now() - interval '30 days';
