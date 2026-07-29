create table if not exists public.lab_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('location', 'sub_location')),
  capacity    integer,
  notes       text,
  last_inspected_at timestamptz,
  inspected_by text,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.lab_locations add column if not exists capacity integer;
alter table public.lab_locations add column if not exists notes text;
alter table public.lab_locations add column if not exists last_inspected_at timestamptz;
alter table public.lab_locations add column if not exists inspected_by text;

create unique index if not exists lab_locations_kind_name_idx
  on public.lab_locations (kind, lower(name));

alter table public.lab_locations enable row level security;

drop policy if exists "lab locations readable by approved users" on public.lab_locations;
create policy "lab locations readable by approved users"
  on public.lab_locations for select
  to authenticated
  using (public.is_approved());

drop policy if exists "admins manage lab locations" on public.lab_locations;
create policy "admins manage lab locations"
  on public.lab_locations for all
  to authenticated
  using (public.is_approved() and public.current_user_role() = 'admin')
  with check (public.is_approved() and public.current_user_role() = 'admin');

notify pgrst, 'reload schema';
