-- ===========================================================================
-- PEARL upgrade: Computational Research Assets + Linux/HPC metadata sync
--
-- Paste this into Supabase SQL Editor on top of the current live schema.
-- Safe to re-run. It only adds missing columns/tables/indexes/policies.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Chemical metadata fields added after the original inventory schema.
-- ---------------------------------------------------------------------------
alter table public.chemicals add column if not exists batch_no text;
alter table public.chemicals add column if not exists concentration text;
alter table public.chemicals add column if not exists sds_url text;
alter table public.chemicals add column if not exists coa_url text;
alter table public.chemicals add column if not exists invoice_url text;
alter table public.chemicals add column if not exists disposal_date date;
alter table public.chemicals add column if not exists disposal_reason text;
alter table public.chemicals add column if not exists disposal_waste_class text;
alter table public.chemicals add column if not exists reorder_url text;
alter table public.chemicals add column if not exists reorder_priority text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chemicals_reorder_priority_check'
      and conrelid = 'public.chemicals'::regclass
  ) then
    alter table public.chemicals
      add constraint chemicals_reorder_priority_check
      check (reorder_priority in ('none', 'watch', 'soon', 'urgent'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Computational research assets.
-- ---------------------------------------------------------------------------
create table if not exists public.research_assets (
  id                    uuid primary key default gen_random_uuid(),
  type                  text not null check (type in ('dataset', 'model', 'simulation', 'code', 'notebook', 'compute', 'sample', 'publication', 'other')),
  title                 text not null,
  description           text,
  project               text,
  owner                 text,
  related_chemical_id   uuid references public.chemicals on delete set null,
  related_chemical_name text,
  source                text,
  source_external_id    text,
  external_path         text,
  storage_link          text,
  size_bytes            bigint,
  size_label            text,
  format                text,
  license               text,
  checksum              text,
  version               text,
  tags                  text[] not null default '{}',
  method                text,
  software              text,
  input_link            text,
  output_link           text,
  repo_link             text,
  environment           text,
  metrics               text,
  access_notes          text,
  status                text not null default 'active' check (status in ('active', 'running', 'complete', 'failed', 'archived')),
  visibility            text not null default 'lab' check (visibility in ('lab', 'private')),
  notes                 text,
  created_by            uuid references auth.users on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_verified_at      date
);

alter table public.research_assets add column if not exists description text;
alter table public.research_assets add column if not exists project text;
alter table public.research_assets add column if not exists owner text;
alter table public.research_assets add column if not exists source text;
alter table public.research_assets add column if not exists source_external_id text;
alter table public.research_assets add column if not exists external_path text;
alter table public.research_assets add column if not exists storage_link text;
alter table public.research_assets add column if not exists size_bytes bigint;
alter table public.research_assets add column if not exists size_label text;
alter table public.research_assets add column if not exists tags text[] not null default '{}';
alter table public.research_assets add column if not exists method text;
alter table public.research_assets add column if not exists software text;
alter table public.research_assets add column if not exists input_link text;
alter table public.research_assets add column if not exists output_link text;
alter table public.research_assets add column if not exists environment text;
alter table public.research_assets add column if not exists metrics text;
alter table public.research_assets add column if not exists visibility text not null default 'lab';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'research_assets_visibility_check'
      and conrelid = 'public.research_assets'::regclass
  ) then
    alter table public.research_assets
      add constraint research_assets_visibility_check check (visibility in ('lab', 'private'));
  end if;
end $$;

create index if not exists research_assets_type_idx on public.research_assets (type);
create index if not exists research_assets_project_idx on public.research_assets (project);
create index if not exists research_assets_related_chemical_idx on public.research_assets (related_chemical_id);
create unique index if not exists research_assets_source_external_idx
  on public.research_assets (created_by, source, source_external_id)
  where source_external_id is not null;

drop trigger if exists research_assets_touch on public.research_assets;
create trigger research_assets_touch
  before update on public.research_assets
  for each row execute function public.touch_updated_at();

create table if not exists public.research_asset_chemicals (
  research_asset_id uuid not null references public.research_assets on delete cascade,
  chemical_id       uuid not null references public.chemicals on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (research_asset_id, chemical_id)
);

create index if not exists research_asset_chemicals_chemical_idx
  on public.research_asset_chemicals (chemical_id);

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table public.research_assets enable row level security;
alter table public.research_asset_chemicals enable row level security;

drop policy if exists "research assets readable by approved users" on public.research_assets;
create policy "research assets readable by approved users"
  on public.research_assets for select
  to authenticated
  using (
    public.is_approved()
    and (
      visibility = 'lab'
      or created_by = (select auth.uid())
    )
  );

drop policy if exists "members add research assets" on public.research_assets;
create policy "members add research assets"
  on public.research_assets for insert
  to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and visibility in ('lab', 'private')
  );

drop policy if exists "members edit research assets" on public.research_assets;
create policy "members edit research assets"
  on public.research_assets for update
  to authenticated
  using (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and (
      visibility = 'lab'
      or created_by = (select auth.uid())
    )
  )
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and visibility in ('lab', 'private')
    and (
      visibility = 'lab'
      or created_by = (select auth.uid())
    )
  );

drop policy if exists "owners and admins delete research assets" on public.research_assets;
create policy "owners and admins delete research assets"
  on public.research_assets for delete
  to authenticated
  using (
    public.is_approved()
    and (public.current_user_role() = 'admin' or created_by = (select auth.uid()))
  );

drop policy if exists "research asset links readable by approved users" on public.research_asset_chemicals;
create policy "research asset links readable by approved users"
  on public.research_asset_chemicals for select
  to authenticated
  using (public.is_approved());

drop policy if exists "members manage research asset links" on public.research_asset_chemicals;
create policy "members manage research asset links"
  on public.research_asset_chemicals for all
  to authenticated
  using (public.is_approved() and public.current_user_role() in ('admin', 'member'))
  with check (public.is_approved() and public.current_user_role() in ('admin', 'member'));

notify pgrst, 'reload schema';
