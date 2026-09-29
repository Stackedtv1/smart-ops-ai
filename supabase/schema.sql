-- SMART Ops AI — demo schema (Supabase / Postgres)
-- Run in Supabase SQL editor. Then create a public Storage bucket named `report-photos`.
--
-- WARNING: the RLS policies at the bottom allow anonymous read/write so the
-- demo works with only the anon key. Replace with Supabase Auth + role-based
-- policies before any real pilot.

create table if not exists garages (
  id text primary key,
  name text not null,
  county text
);

create table if not exists departments (
  id text primary key,          -- maintenance | facilities | safety | operations | supervisor
  name text not null
);

create table if not exists users (
  id text primary key,          -- employee id, e.g. DEMO-1047
  name text not null,
  role text not null check (role in ('operator','supervisor','maintenance','facilities','admin')),
  garage_id text references garages(id),
  department_id text references departments(id)
);

create table if not exists vehicles (
  id text primary key,          -- fleet number
  fleet_number text not null,
  garage text references garages(id),
  vehicle_type text,
  status text default 'in_service'
);

create table if not exists routes (
  id text primary key,          -- public route number, e.g. 461
  name text not null,
  route_type text
);

create table if not exists stops (
  id text primary key,
  name text not null,
  latitude double precision,
  longitude double precision,
  route_ids text[]
);

-- Denormalized ticket row + full JSON payload the UI renders.
create table if not exists tickets (
  id text primary key,          -- SMART-YYMMDD-NNNN
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vehicle_id text,
  route_id text,
  stop_id text,
  operator_id text,
  category text,
  subcategory text,
  priority text check (priority in ('high','medium','low')),
  department text,
  status text check (status in ('New','Assigned','In Progress','Resolved')),
  assignee text,
  summary text,
  latitude double precision,
  longitude double precision,
  payload jsonb not null
);
create index if not exists tickets_status_idx on tickets (status);
create index if not exists tickets_dept_idx on tickets (department);
create index if not exists tickets_vehicle_idx on tickets (vehicle_id, subcategory, created_at);
create index if not exists tickets_stop_idx on tickets (stop_id, category, created_at);

-- Raw operator report (what was said/typed), kept separate from the AI output.
create table if not exists reports (
  id bigint generated always as identity primary key,
  ticket_id text references tickets(id) on delete cascade,
  operator_id text,
  vehicle_id text,
  route_id text,
  stop_id text,
  latitude double precision,
  longitude double precision,
  voice_text text,
  typed_text text,
  photo_url text,
  ai_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists assignments (
  id bigint generated always as identity primary key,
  ticket_id text references tickets(id) on delete cascade,
  department_id text references departments(id),
  assignee text,
  assigned_at timestamptz not null default now()
);

create table if not exists photos (
  id bigint generated always as identity primary key,
  ticket_id text references tickets(id) on delete cascade,
  url text not null,
  kind text default 'evidence',  -- evidence | repair
  created_at timestamptz not null default now()
);

create table if not exists status_history (
  id bigint generated always as identity primary key,
  ticket_id text references tickets(id) on delete cascade,
  label text not null,
  actor text,
  created_at timestamptz not null default now()
);

-- Seed reference data -------------------------------------------------------
insert into departments (id, name) values
  ('maintenance','Maintenance'), ('facilities','Facilities'), ('safety','Safety'),
  ('operations','Operations'), ('supervisor','Supervisor')
on conflict do nothing;

insert into garages (id, name, county) values
  ('oakland','Oakland Terminal','Oakland'), ('macomb','Macomb Terminal','Macomb'), ('wayne','Wayne Terminal','Wayne')
on conflict do nothing;

insert into routes (id, name, route_type) values
  ('261','FAST Michigan','FAST'), ('461','FAST Woodward','FAST'), ('462','FAST Woodward','FAST'),
  ('500','Mound/Hamtramck','Local'), ('510','Van Dyke','Local'), ('494','Dequindre','Local'), ('250','Ford Road','Local')
on conflict do nothing;

insert into vehicles (id, fleet_number, garage, vehicle_type) values
  ('4602','4602','oakland','40 ft low-floor'), ('4128','4128','oakland','40 ft low-floor'), ('4210','4210','oakland','40 ft low-floor'),
  ('3852','3852','macomb','40 ft low-floor'), ('3987','3987','macomb','40 ft low-floor'), ('3990','3990','macomb','40 ft low-floor'),
  ('4490','4490','macomb','40 ft low-floor'), ('4731','4731','macomb','35 ft low-floor'), ('4415','4415','wayne','40 ft low-floor'),
  ('4588','4588','wayne','40 ft low-floor'), ('4077','4077','wayne','40 ft low-floor')
on conflict do nothing;

insert into users (id, name, role, garage_id) values
  ('DEMO-1047','Marcus Johnson','operator','oakland')
on conflict do nothing;

-- Realtime: stream ticket changes to every open dashboard ---------------------
alter publication supabase_realtime add table tickets;

-- Demo-only access policies ---------------------------------------------------
alter table tickets enable row level security;
alter table reports enable row level security;
alter table status_history enable row level security;
create policy "demo anon all tickets" on tickets for all using (true) with check (true);
create policy "demo anon all reports" on reports for all using (true) with check (true);
create policy "demo anon all history" on status_history for all using (true) with check (true);

-- Storage bucket for photos (public read for the demo)
insert into storage.buckets (id, name, public) values ('report-photos','report-photos', true)
on conflict do nothing;
create policy "demo anon upload photos" on storage.objects for insert with check (bucket_id = 'report-photos');
create policy "demo anon read photos" on storage.objects for select using (bucket_id = 'report-photos');
