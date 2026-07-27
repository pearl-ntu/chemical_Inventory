-- ===========================================================================
--  PEARL Inventory — database schema
--  PEARL Group · Prof. Xiaogang Liu Lab · NTU Singapore
--
--  HOW TO USE
--    1. Create a free project at https://supabase.com
--    2. Open  SQL Editor  ->  New query
--    3. Paste this whole file, press Run.
--    4. (Optional) Do the same with `seed.sql` to load the lab's 235 existing
--       containers.
--
--  Safe to re-run: every statement is idempotent.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles — one row per user account, created automatically on sign-up
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text not null,
  full_name    text not null default '',
  role         text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  lab_position text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- chemicals — one row per physical container on the shelf
-- ---------------------------------------------------------------------------
create table if not exists public.chemicals (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,
  name              text not null,
  cas               text,
  system            text,
  supplier          text,
  catalog_no        text,
  location          text,
  sub_location      text,
  formula           text,
  mol_weight        numeric,
  purity            text,
  quantity          integer not null default 1 check (quantity >= 0),
  size_value        numeric,
  size_unit         text not null default 'g',
  price             numeric,
  currency          text not null default 'SGD',
  owner             text,
  project           text,
  registration_date date default current_date,
  opened_date       date,
  expiry_date       date,
  status            text not null default 'active'
                    check (status in ('active', 'low', 'empty', 'disposed')),
  date_emptied      date,
  hazards           text[] not null default '{}',
  storage_class     text,
  remarks           text,
  registered_by     text,
  created_by        uuid references auth.users on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Approval workflow columns, added via ALTER so this file stays safe to
-- re-run against a database that already has the table from an earlier
-- version of this schema (not just a brand new one).
alter table public.chemicals
  add column if not exists review_status text not null default 'approved',
  add column if not exists reviewed_by   uuid references auth.users on delete set null,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists rejection_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chemicals_review_status_check'
  ) then
    alter table public.chemicals
      add constraint chemicals_review_status_check
      check (review_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists chemicals_name_idx          on public.chemicals (lower(name));
create index if not exists chemicals_cas_idx           on public.chemicals (cas);
create index if not exists chemicals_location_idx      on public.chemicals (location);
create index if not exists chemicals_status_idx        on public.chemicals (status);
create index if not exists chemicals_review_status_idx on public.chemicals (review_status);

-- Full-text-ish search across the fields people actually search by.
create index if not exists chemicals_search_idx on public.chemicals
  using gin (to_tsvector('simple',
    coalesce(name, '') || ' ' || coalesce(cas, '') || ' ' ||
    coalesce(supplier, '') || ' ' || coalesce(location, '') || ' ' ||
    coalesce(code, '')));

-- ---------------------------------------------------------------------------
-- activity_log — append-only audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.activity_log (
  id            uuid primary key default gen_random_uuid(),
  chemical_id   uuid references public.chemicals on delete set null,
  chemical_name text,
  action        text not null,
  details       text,
  user_id       uuid references auth.users on delete set null,
  user_name     text,
  created_at    timestamptz not null default now()
);

create index if not exists activity_created_idx on public.activity_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so policies on `profiles` can call it without recursing
-- into their own RLS check.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer');
$$;

-- Auto-create a profile whenever someone signs up. The very first account to
-- be created becomes the admin, so the lab is never locked out of its own data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  select count(*) = 0 into is_first from public.profiles;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'member' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists chemicals_touch on public.chemicals;
create trigger chemicals_touch
  before update on public.chemicals
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Approval workflow
--
--   admin  submits  -> approved immediately (already trusted)
--   member submits  -> pending, invisible to the rest of the group until an
--                       admin approves it (see the select policy below)
--
-- Enforced here, not in the client: a member calling the API directly could
-- otherwise set review_status = 'approved' on their own insert. These
-- triggers make that impossible regardless of what the request body says.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_review_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() = 'admin' then
    new.review_status := coalesce(new.review_status, 'approved');
  else
    new.review_status   := 'pending';
    new.reviewed_by      := null;
    new.reviewed_at      := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists chemicals_enforce_review_insert on public.chemicals;
create trigger chemicals_enforce_review_insert
  before insert on public.chemicals
  for each row execute function public.enforce_review_on_insert();

create or replace function public.enforce_review_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.review_status is distinct from old.review_status then
    -- Approving or rejecting is an admin-only action, whoever is issuing
    -- the UPDATE. Stamp who did it and when — the client can't set these.
    if public.current_user_role() <> 'admin' then
      raise exception 'Only an admin can approve or reject a submission.';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  elsif public.current_user_role() <> 'admin'
        and old.review_status in ('pending', 'rejected')
        and old.created_by = auth.uid() then
    -- The submitter editing their own not-yet-approved entry is treated as a
    -- resubmission: back to the queue, any earlier rejection note cleared.
    new.review_status    := 'pending';
    new.reviewed_by       := null;
    new.reviewed_at       := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists chemicals_enforce_review_update on public.chemicals;
create trigger chemicals_enforce_review_update
  before update on public.chemicals
  for each row execute function public.enforce_review_on_update();

-- Allocate the next PEARL-#### code. Used when the client doesn't supply one.
create or replace function public.next_chemical_code()
returns text
language sql
stable
as $$
  select 'PEARL-' || lpad((
    coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 4, '0')
  from public.chemicals
  where code ~ '^PEARL-\d+$';
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--   viewer -> read only (approved entries only)
--   member -> read approved entries + their own pending/rejected ones;
--             add new entries (held for admin approval); edit approved
--             entries or their own unapproved ones
--   admin  -> everything, including approving/rejecting, deletes, and
--             managing roles
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.chemicals    enable row level security;
alter table public.activity_log enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users edit their own profile" on public.profiles;
create policy "users edit their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()));

drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles"
  on public.profiles for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- chemicals -----------------------------------------------------------------
-- A pending or rejected submission is visible only to the person who
-- submitted it and to admins (who need to see it to review it). Everyone
-- else — including other members — simply doesn't see the row until it's
-- approved, which is what makes the queue actually gate the shared shelf
-- rather than just hiding a button in the UI.
drop policy if exists "inventory readable by signed-in users" on public.chemicals;
create policy "inventory readable by signed-in users"
  on public.chemicals for select
  to authenticated
  using (
    review_status = 'approved'
    or created_by = auth.uid()
    or public.current_user_role() = 'admin'
  );

drop policy if exists "members add inventory" on public.chemicals;
create policy "members add inventory"
  on public.chemicals for insert
  to authenticated
  with check (public.current_user_role() in ('admin', 'member'));

-- A member may edit any already-approved row (the shared, vetted shelf stays
-- collaboratively maintained, as before) or their own not-yet-approved
-- submission (to fix and resubmit). They may not touch someone else's
-- pending or rejected entry — an admin can, to review it.
drop policy if exists "members edit inventory" on public.chemicals;
create policy "members edit inventory"
  on public.chemicals for update
  to authenticated
  using (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() = 'member'
      and (review_status = 'approved' or created_by = auth.uid())
    )
  )
  with check (
    public.current_user_role() = 'admin'
    or (
      public.current_user_role() = 'member'
      and (review_status = 'approved' or created_by = auth.uid())
    )
  );

-- Deleting is deliberately narrow: the person who registered the container, or
-- an admin. Everyone else marks it `empty`, which keeps the history intact.
drop policy if exists "owners and admins delete inventory" on public.chemicals;
create policy "owners and admins delete inventory"
  on public.chemicals for delete
  to authenticated
  using (public.current_user_role() = 'admin' or created_by = auth.uid());

-- activity_log --------------------------------------------------------------
drop policy if exists "activity readable by signed-in users" on public.activity_log;
create policy "activity readable by signed-in users"
  on public.activity_log for select
  to authenticated
  using (true);

drop policy if exists "signed-in users append activity" on public.activity_log;
create policy "signed-in users append activity"
  on public.activity_log for insert
  to authenticated
  with check (user_id = auth.uid());
-- No update/delete policy: the audit trail is append-only by construction.

-- ---------------------------------------------------------------------------
-- Convenience view: current stock grouped by location, for the dashboard.
--
-- `security_invoker = true` is required here: without it, Postgres runs the
-- view's query as its *owner* (a superuser role in Supabase), which checks
-- the view owner's permissions instead of the querying user's — silently
-- bypassing the RLS policies on `chemicals` for anyone who can query this
-- view. With it set, the view enforces exactly the policies above, the way a
-- reasonable person would expect a "view" to behave.
-- ---------------------------------------------------------------------------
create or replace view public.location_summary
  with (security_invoker = true) as
  select
    coalesce(location, 'Unassigned') as location,
    count(*)                          as containers,
    count(*) filter (where status = 'active') as active,
    count(*) filter (where status = 'low')    as low,
    count(*) filter (where status = 'empty')  as empty
  from public.chemicals
  where review_status = 'approved'
  group by 1
  order by 2 desc;
