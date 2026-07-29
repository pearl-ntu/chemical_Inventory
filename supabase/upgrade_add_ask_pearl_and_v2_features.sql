-- ===========================================================================
-- PEARL upgrade: Ask PEARL + experimental/computational v2 feature tables.
--
-- Paste this into Supabase SQL Editor on top of the current live schema.
-- Safe to re-run. It only adds missing columns/tables/indexes/policies.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Stable computational asset identifiers.
-- ---------------------------------------------------------------------------
alter table public.research_assets add column if not exists stable_id text;

create unique index if not exists research_assets_stable_id_idx
  on public.research_assets (stable_id)
  where stable_id is not null;

create or replace function public.next_research_asset_stable_id()
returns text
language sql
stable
set search_path = public
as $$
  select 'PEARL-RA-' || lpad((
    coalesce(max(nullif(regexp_replace(stable_id, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 6, '0')
  from public.research_assets
  where stable_id ~ '^PEARL-RA-\d+$';
$$;

with existing as (
  select coalesce(max(nullif(regexp_replace(stable_id, '\D', '', 'g'), '')::bigint), 0) as max_n
  from public.research_assets
  where stable_id ~ '^PEARL-RA-\d+$'
),
numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.research_assets
  where stable_id is null
)
update public.research_assets asset
set stable_id = 'PEARL-RA-' || lpad((existing.max_n + numbered.rn)::text, 6, '0')
from numbered, existing
where asset.id = numbered.id;

-- ---------------------------------------------------------------------------
-- Version history for computational assets. Private through parent asset RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.research_asset_versions (
  id                uuid primary key default gen_random_uuid(),
  research_asset_id uuid not null references public.research_assets on delete cascade,
  version_number    text not null,
  checksum          text,
  size_bytes        bigint,
  size_label        text,
  external_path     text,
  created_at        timestamptz not null default now(),
  notes             text,
  created_by        uuid references auth.users on delete set null,
  created_by_name   text
);

create index if not exists research_asset_versions_asset_idx
  on public.research_asset_versions (research_asset_id, created_at desc);

create unique index if not exists research_asset_versions_asset_version_idx
  on public.research_asset_versions (research_asset_id, version_number);

alter table public.research_asset_versions enable row level security;

drop policy if exists "research asset versions readable by owner" on public.research_asset_versions;
create policy "research asset versions readable by owner"
  on public.research_asset_versions for select
  to authenticated
  using (
    public.is_approved()
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  );

drop policy if exists "members add research asset versions" on public.research_asset_versions;
create policy "members add research asset versions"
  on public.research_asset_versions for insert
  to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  );

drop policy if exists "members edit research asset versions" on public.research_asset_versions;
create policy "members edit research asset versions"
  on public.research_asset_versions for update
  to authenticated
  using (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  )
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  );

drop policy if exists "owners delete research asset versions" on public.research_asset_versions;
create policy "owners delete research asset versions"
  on public.research_asset_versions for delete
  to authenticated
  using (
    public.is_approved()
    and created_by = (select auth.uid())
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Lineage between private computational assets.
-- ---------------------------------------------------------------------------
create table if not exists public.research_asset_links (
  id              uuid primary key default gen_random_uuid(),
  source_asset_id uuid not null references public.research_assets on delete cascade,
  target_asset_id uuid not null references public.research_assets on delete cascade,
  relationship    text not null check (relationship in ('derived_from', 'input_to', 'related_to')),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users on delete set null,
  created_by_name text,
  notes           text,
  check (source_asset_id <> target_asset_id)
);

create index if not exists research_asset_links_source_idx
  on public.research_asset_links (source_asset_id);
create index if not exists research_asset_links_target_idx
  on public.research_asset_links (target_asset_id);
create unique index if not exists research_asset_links_unique_idx
  on public.research_asset_links (source_asset_id, target_asset_id, relationship);

alter table public.research_asset_links enable row level security;

drop policy if exists "research asset lineage readable by owner" on public.research_asset_links;
create policy "research asset lineage readable by owner"
  on public.research_asset_links for select
  to authenticated
  using (
    public.is_approved()
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.research_assets source
      where source.id = source_asset_id
        and source.created_by = (select auth.uid())
    )
    and exists (
      select 1 from public.research_assets target
      where target.id = target_asset_id
        and target.created_by = (select auth.uid())
    )
  );

drop policy if exists "members manage research asset lineage" on public.research_asset_links;
create policy "members manage research asset lineage"
  on public.research_asset_links for all
  to authenticated
  using (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.research_assets source
      where source.id = source_asset_id
        and source.created_by = (select auth.uid())
    )
    and exists (
      select 1 from public.research_assets target
      where target.id = target_asset_id
        and target.created_by = (select auth.uid())
    )
  )
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.research_assets source
      where source.id = source_asset_id
        and source.created_by = (select auth.uid())
    )
    and exists (
      select 1 from public.research_assets target
      where target.id = target_asset_id
        and target.created_by = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Experimental purchase/request workflow. Shared like chemical inventory.
-- ---------------------------------------------------------------------------
create table if not exists public.chemical_requests (
  id                   uuid primary key default gen_random_uuid(),
  requested_by          uuid references auth.users on delete set null,
  requested_by_name     text,
  chemical_name_or_cas  text not null,
  quantity              text,
  supplier              text,
  justification_project text,
  status                text not null default 'pending'
                        check (status in ('pending', 'approved', 'declined', 'received')),
  requested_at          timestamptz not null default now(),
  decided_by            uuid references auth.users on delete set null,
  decided_by_name       text,
  decided_at            timestamptz,
  received_container_id uuid references public.chemicals on delete set null,
  notes                 text
);

create index if not exists chemical_requests_status_idx
  on public.chemical_requests (status, requested_at desc);
create index if not exists chemical_requests_requested_by_idx
  on public.chemical_requests (requested_by, requested_at desc);

alter table public.chemical_requests enable row level security;

drop policy if exists "chemical requests readable by approved users" on public.chemical_requests;
create policy "chemical requests readable by approved users"
  on public.chemical_requests for select
  to authenticated
  using (public.is_approved());

drop policy if exists "members create chemical requests" on public.chemical_requests;
create policy "members create chemical requests"
  on public.chemical_requests for insert
  to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and requested_by = (select auth.uid())
  );

drop policy if exists "requesters and admins update chemical requests" on public.chemical_requests;
create policy "requesters and admins update chemical requests"
  on public.chemical_requests for update
  to authenticated
  using (
    public.is_approved()
    and (
      public.current_user_role() = 'admin'
      or (requested_by = (select auth.uid()) and status = 'pending')
    )
  )
  with check (
    public.is_approved()
    and (
      public.current_user_role() = 'admin'
      or (requested_by = (select auth.uid()) and status = 'pending')
    )
  );

drop policy if exists "admins delete chemical requests" on public.chemical_requests;
create policy "admins delete chemical requests"
  on public.chemical_requests for delete
  to authenticated
  using (public.is_approved() and public.current_user_role() = 'admin');

notify pgrst, 'reload schema';
