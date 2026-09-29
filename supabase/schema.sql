-- SMART Ops AI — live demo schema (Supabase / Postgres).
-- Applied to the shared project as migration "smart_ops_ai_live_demo".
-- Tables are prefixed so_ so they can live beside another app's tables.
--
-- so_tickets: one row per ticket, full ticket JSON in payload.
-- so_meta:    shared demo state — keys 'guardian' (detections, audit trail,
--             follow-ups), 'fleet' (simulated mileage, work requests),
--             'control' (demo day, ticket sequence, last reset).
--             `version` lets only one Guardian check write per version.
--
-- WARNING: demo-only policies let anyone with the anon key read and write.
-- Replace with Supabase Auth + role policies before any real pilot.

create table if not exists public.so_tickets (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.so_meta (
  key text primary key,
  value jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.so_tickets enable row level security;
alter table public.so_meta enable row level security;

drop policy if exists "so demo tickets" on public.so_tickets;
create policy "so demo tickets" on public.so_tickets for all to anon, authenticated using (true) with check (true);
drop policy if exists "so demo meta" on public.so_meta;
create policy "so demo meta" on public.so_meta for all to anon, authenticated using (true) with check (true);

alter publication supabase_realtime add table public.so_tickets;
alter publication supabase_realtime add table public.so_meta;
