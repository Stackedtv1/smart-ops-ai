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

-- ---------------------------------------------------------------------------
-- Visit tracking (migration "smart_ops_ai_visit_tracking").
-- so_visits: one row per app open / demo sign-in, written by the track-visit
--            Netlify function. Anon may INSERT only — nobody can read it directly.
-- so_owner:  the owner key (no policies, so anon can't read it). The key value
--            lives only in the database; set it with:
--            update so_owner set key = '<new key>' where id = 1;
-- so_visit_report(key): returns the log only when the key matches. Read it in
--            the app at /#/owner?key=<key>.

create table if not exists public.so_visits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null check (event in ('open','login','presenter')),
  role text, account text, visitor text, device text, browser text,
  city text, region text, country text, referrer text,
  is_owner boolean not null default false
);
create index if not exists so_visits_at_idx on public.so_visits (at desc);
alter table public.so_visits enable row level security;
drop policy if exists "so visits insert" on public.so_visits;
create policy "so visits insert" on public.so_visits for insert to anon, authenticated
  with check (event in ('open','login','presenter') and length(coalesce(visitor,'')) <= 64 and length(coalesce(referrer,'')) <= 300);

create table if not exists public.so_owner (id int primary key default 1 check (id = 1), key text not null);
alter table public.so_owner enable row level security;

create or replace function public.so_visit_report(p_key text, p_include_owner boolean default false)
returns setof public.so_visits
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.so_owner where key = p_key) then
    raise exception 'not allowed';
  end if;
  return query select * from public.so_visits v where p_include_owner or not v.is_owner order by v.at desc limit 2000;
end $$;
revoke all on function public.so_visit_report(text, boolean) from public;
grant execute on function public.so_visit_report(text, boolean) to anon, authenticated;
