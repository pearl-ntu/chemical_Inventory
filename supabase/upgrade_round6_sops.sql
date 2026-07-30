-- SOP / protocol library -----------------------------------------------------
-- Simple CRUD, linked from the record it applies to (a chemical, a piece
-- of equipment) so "how do I safely handle/operate this" is one click away
-- rather than a separate library nobody remembers to check.
create table if not exists public.sops (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  body                text not null default '',
  related_chemical_ids uuid[] not null default '{}',
  related_equipment_id uuid references public.equipment(id) on delete set null,
  created_by          uuid references public.profiles(id) on delete set null,
  created_by_name     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists sops_related_equipment_idx on public.sops (related_equipment_id);
alter table public.sops enable row level security;

drop policy if exists "sops readable by approved users" on public.sops;
create policy "sops readable by approved users"
  on public.sops for select
  to authenticated
  using (public.is_approved());

drop policy if exists "admins and members create sops" on public.sops;
create policy "admins and members create sops"
  on public.sops for insert
  to authenticated
  with check (public.is_approved() and public.current_user_role() in ('admin', 'member'));

drop policy if exists "admins and members edit sops" on public.sops;
create policy "admins and members edit sops"
  on public.sops for update
  to authenticated
  using (public.is_approved() and public.current_user_role() in ('admin', 'member'));

drop policy if exists "authors and admins delete sops" on public.sops;
create policy "authors and admins delete sops"
  on public.sops for delete
  to authenticated
  using (public.is_approved() and (created_by = (select auth.uid()) or public.current_user_role() = 'admin'));

notify pgrst, 'reload schema';
