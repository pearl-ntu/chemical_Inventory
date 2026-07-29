-- ============================================================================
-- PEARL Round 4 collaboration upgrades
-- Ownership transfer audit log for member offboarding/handover.
-- ============================================================================

create table if not exists public.ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('chemical', 'research_asset')),
  resource_id uuid not null,
  from_member uuid references public.profiles(id) on delete set null,
  from_member_name text,
  to_member uuid references public.profiles(id) on delete set null,
  to_member_name text,
  transferred_by uuid references public.profiles(id) on delete set null,
  transferred_by_name text,
  transferred_at timestamptz not null default now()
);

create index if not exists ownership_transfers_resource_idx
  on public.ownership_transfers (resource_type, resource_id, transferred_at desc);

create index if not exists ownership_transfers_member_idx
  on public.ownership_transfers (from_member, to_member, transferred_at desc);

alter table public.ownership_transfers enable row level security;

drop policy if exists "admins read ownership transfers" on public.ownership_transfers;
create policy "admins read ownership transfers"
  on public.ownership_transfers for select
  to authenticated
  using (public.is_approved() and public.current_user_role() = 'admin');

drop policy if exists "no direct ownership transfer writes" on public.ownership_transfers;
create policy "no direct ownership transfer writes"
  on public.ownership_transfers for all
  to authenticated
  using (false)
  with check (false);

notify pgrst, 'reload schema';

-- Comments on chemicals, research assets, and equipment bookings.
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('chemical', 'research_asset', 'equipment_booking')),
  resource_id uuid not null,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index if not exists comments_resource_idx on public.comments (resource_type, resource_id, created_at);
alter table public.comments enable row level security;

drop policy if exists "comments readable by parent visibility" on public.comments;
create policy "comments readable by parent visibility"
  on public.comments for select
  to authenticated
  using (
    public.is_approved()
    and (
      resource_type in ('chemical', 'equipment_booking')
      or exists (
        select 1 from public.research_assets asset
        where asset.id = resource_id and asset.created_by = (select auth.uid())
      )
    )
  );

drop policy if exists "members add comments" on public.comments;
create policy "members add comments"
  on public.comments for insert
  to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and author_id = (select auth.uid())
  );

drop policy if exists "comment authors delete own comments" on public.comments;
create policy "comment authors delete own comments"
  on public.comments for delete
  to authenticated
  using (
    public.is_approved()
    and (author_id = (select auth.uid()) or public.current_user_role() = 'admin')
  );

-- Shared equipment and bookings.
create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.equipment_bookings (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  booked_by uuid references public.profiles(id) on delete set null,
  booked_by_name text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  purpose text not null,
  related_research_asset_id uuid references public.research_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists equipment_bookings_equipment_time_idx
  on public.equipment_bookings (equipment_id, start_time, end_time);

create or replace function public.prevent_equipment_booking_overlap()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.equipment_bookings existing
    where existing.equipment_id = new.equipment_id
      and existing.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(existing.start_time, existing.end_time, '[)') && tstzrange(new.start_time, new.end_time, '[)')
  ) then
    raise exception 'This equipment is already booked for that time.';
  end if;
  return new;
end $$;

drop trigger if exists equipment_booking_overlap_guard on public.equipment_bookings;
create trigger equipment_booking_overlap_guard
  before insert or update on public.equipment_bookings
  for each row execute function public.prevent_equipment_booking_overlap();

alter table public.equipment enable row level security;
alter table public.equipment_bookings enable row level security;

drop policy if exists "equipment readable by approved users" on public.equipment;
create policy "equipment readable by approved users"
  on public.equipment for select to authenticated
  using (public.is_approved());

drop policy if exists "members manage equipment" on public.equipment;
create policy "members manage equipment"
  on public.equipment for all to authenticated
  using (public.is_approved() and public.current_user_role() in ('admin', 'member'))
  with check (public.is_approved() and public.current_user_role() in ('admin', 'member'));

drop policy if exists "equipment bookings readable by approved users" on public.equipment_bookings;
create policy "equipment bookings readable by approved users"
  on public.equipment_bookings for select to authenticated
  using (public.is_approved());

drop policy if exists "members create equipment bookings" on public.equipment_bookings;
create policy "members create equipment bookings"
  on public.equipment_bookings for insert to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and booked_by = (select auth.uid())
  );

drop policy if exists "booking owners and admins delete bookings" on public.equipment_bookings;
create policy "booking owners and admins delete bookings"
  on public.equipment_bookings for delete to authenticated
  using (
    public.is_approved()
    and (booked_by = (select auth.uid()) or public.current_user_role() = 'admin')
  );

notify pgrst, 'reload schema';
