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

-- `approved` gates whether an account can see the inventory *at all* — added
-- via a guarded block, not a plain ALTER, because the backfill below must run
-- exactly once. Re-running this file on a database that already has the
-- column must not re-approve everyone who's since signed up and is still
-- waiting on an admin.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'approved'
  ) then
    alter table public.profiles add column approved boolean not null default false;
    -- Grandfather in every account that already existed before this gate was
    -- added — nobody who already had access should be locked out by the
    -- upgrade. Only sign-ups from this point on start unapproved.
    update public.profiles set approved = true;
  end if;
end $$;

create index if not exists profiles_approved_idx on public.profiles (approved);

-- `has_password` gates the one-time "set a password" prompt shown right
-- after a magic-link/invite sign-in — someone who's only ever clicked an
-- email link has no password to fall back on if the next email is slow or
-- lands in spam. Backfilled precisely from whether Supabase actually stored
-- a password hash for the account, not guessed — so nobody who already has
-- a password gets nagged for one.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'has_password'
  ) then
    alter table public.profiles add column has_password boolean not null default false;
    update public.profiles p
    set has_password = true
    from auth.users u
    where u.id = p.id
      and u.encrypted_password is not null
      and u.encrypted_password <> '';
  end if;
end $$;

-- Safety net, not a one-time migration: a profiles row is normally created by
-- the on_auth_user_created trigger below, but that only fires for accounts
-- created *after* it existed — anyone signed up directly against auth.users
-- before this whole table was added has no row at all, and gets stuck on the
-- read-only, in-memory fallback in api.ts's currentProfile() forever (which
-- can't know the account already has a real password, so it keeps prompting
-- for one Supabase then correctly refuses to "change" to the same value).
-- Grandfathered the same way `approved` was above: viewer (an admin already
-- exists for every project reaching this point — the very first account is
-- handled by the trigger itself), approved so nobody who could already use
-- the app gets newly locked out, has_password read straight from whether a
-- real password is on file. Safe to re-run — the anti-join only ever
-- targets rows that are still actually missing.
insert into public.profiles (id, email, full_name, role, approved, has_password)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
  'viewer',
  true,
  (u.encrypted_password is not null and u.encrypted_password <> '')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

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

-- The MDL Molfile from the built-in 2D structure editor. Nullable — plenty of
-- entries will only ever have a PubChem-looked-up depiction, not a hand-drawn
-- one, and that's fine.
alter table public.chemicals add column if not exists structure_molfile text;

-- An optional drawn synthesis scheme (reactants/reagents/products), stored as
-- an RXN-format file — same idea as structure_molfile, for a reaction instead
-- of a single molecule. Nullable; most entries won't have one.
alter table public.chemicals add column if not exists reaction_rxnfile text;

-- A path (not a public URL) into the delivery-photos storage bucket below —
-- a photo of the delivery order/invoice for this container, kept for
-- reference. A path rather than a URL because the bucket is private; the
-- client signs a temporary URL from this path whenever it actually needs to
-- display the image.
alter table public.chemicals add column if not exists delivery_photo_path text;

create index if not exists chemicals_name_idx       on public.chemicals (lower(name));
create index if not exists chemicals_cas_idx        on public.chemicals (cas);
create index if not exists chemicals_location_idx   on public.chemicals (location);
create index if not exists chemicals_status_idx     on public.chemicals (status);
-- Covers the created_by foreign key — without it, every delete/update on
-- auth.users forces a full table scan of chemicals to check for orphans.
create index if not exists chemicals_created_by_idx on public.chemicals (created_by);

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

create index if not exists activity_created_idx    on public.activity_log (created_at desc);
create index if not exists activity_chemical_id_idx on public.activity_log (chemical_id);
create index if not exists activity_user_id_idx     on public.activity_log (user_id);

-- ---------------------------------------------------------------------------
-- invites — a durable record that an invite was sent, independent of whether
-- the person has opened the email yet.
--
-- Without this, "invite someone" was fire-and-forget: it triggered an email
-- and nothing else, so there was no way to tell whether it actually went out,
-- who was invited, or when — it just looked like it vanished. The Members
-- page now lists every row here whose email doesn't yet match a profile as
-- "invited, not yet joined".
-- ---------------------------------------------------------------------------
create table if not exists public.invites (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  full_name        text,
  invited_by       uuid references auth.users on delete set null,
  invited_by_name  text,
  created_at       timestamptz not null default now()
);

create index if not exists invites_email_idx on public.invites (lower(email));

alter table public.invites enable row level security;

drop policy if exists "admins manage invites" on public.invites;
create policy "admins manage invites"
  on public.invites for all
  to authenticated
  using (public.is_approved() and public.current_user_role() = 'admin')
  with check (public.is_approved() and public.current_user_role() = 'admin');

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
  select coalesce((select role from public.profiles where id = (select auth.uid())), 'viewer');
$$;

-- Only signed-in users ever need this (it's used inside RLS policies
-- evaluated for the `authenticated` role); revoking the default PUBLIC grant
-- stops an anonymous request from calling it directly for no reason.
revoke execute on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- Whether an admin has actually let this account in. This is the real gate on
-- an open sign-up page: `role` only controls what an *approved* account can
-- do, so without this, a brand-new, unvetted account could read the entire
-- inventory the instant it signed up.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select approved from public.profiles where id = (select auth.uid())), false);
$$;

revoke execute on function public.is_approved() from public;
grant execute on function public.is_approved() to authenticated;

-- Auto-create a profile whenever someone signs up. The very first account to
-- be created becomes the admin, so the lab is never locked out of its own data.
--
-- Everyone after that lands as `viewer` — read-only — not `member`. Sign-up
-- is open to any email address (no domain allow-list), so a brand-new,
-- unvetted account should not be able to add, edit, or delete inventory on
-- day one. An admin promotes someone to `member` from the Members page once
-- they actually recognise them. This is the real gate — not a UI toggle, a
-- default that ships with write access switched off.
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

  insert into public.profiles (id, email, full_name, role, approved, has_password)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'viewer' end,
    is_first,
    new.encrypted_password is not null and new.encrypted_password <> ''
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Nothing except the trigger below ever needs to call this directly — a
-- trigger fires with the definer's rights regardless of grants, so revoking
-- PUBLIC's default execute grant closes it off without touching the trigger.
revoke execute on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists chemicals_touch on public.chemicals;
create trigger chemicals_touch
  before update on public.chemicals
  for each row execute function public.touch_updated_at();

-- Allocate the next PEARL-#### code. Used when the client doesn't supply one.
create or replace function public.next_chemical_code()
returns text
language sql
stable
set search_path = public
as $$
  select 'PEARL-' || lpad((
    coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 4, '0')
  from public.chemicals
  where code ~ '^PEARL-\d+$';
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--   (unapproved) -> sees nothing at all except their own profile row
--   viewer       -> read only, once approved
--   member       -> read + add/edit inventory, once approved
--   admin        -> everything, including approving accounts, deletes, and
--                   managing roles
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.chemicals    enable row level security;
alter table public.activity_log enable row level security;

-- profiles ------------------------------------------------------------------
-- One policy per command, not "for all" layered on top of the others — two
-- overlapping permissive policies on the same command both get evaluated and
-- OR'd together for every row, which is wasted work Postgres has to redo on
-- every query. A single policy per command does the same thing, once.
--
-- A pending account can only see its OWN row (so the app can show "you're
-- waiting on approval, signed in as you@example.com") — not the rest of the
-- group's names and emails. Once approved, the member directory opens up.
drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.is_approved());

-- Either you're editing your own profile (and can't hand yourself a new
-- role that way — that goes through the admin branch below), or you're an
-- admin editing anyone's, role included.
drop policy if exists "users edit their own profile" on public.profiles;
-- IMPORTANT: never embed a raw subquery on `profiles` inside a policy ON
-- `profiles` — that's what "infinite recursion detected in policy for
-- relation profiles" means. Evaluating the policy requires evaluating the
-- subquery, which is itself subject to this table's RLS, which requires
-- evaluating the policy again. Route every such lookup through
-- current_user_role()/is_approved() instead — both SECURITY DEFINER, so they
-- bypass RLS on the way in rather than triggering it again.
drop policy if exists "profile updates" on public.profiles;
create policy "profile updates"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()) or public.current_user_role() = 'admin')
  with check (
    (id = (select auth.uid()) and role = public.current_user_role())
    or public.current_user_role() = 'admin'
  );

drop policy if exists "admins manage profiles" on public.profiles;
drop policy if exists "admins delete profiles" on public.profiles;
create policy "admins delete profiles"
  on public.profiles for delete
  to authenticated
  using (public.current_user_role() = 'admin');

-- chemicals -----------------------------------------------------------------
-- The core of the access-approval gate: an unapproved account cannot see a
-- single row here, full stop — not "sees it read-only", not "sees it with
-- edit buttons hidden". This is what actually stops "anyone can sign up and
-- see our inventory"; the sign-up form itself was never the real boundary.
drop policy if exists "inventory readable by signed-in users" on public.chemicals;
create policy "inventory readable by signed-in users"
  on public.chemicals for select
  to authenticated
  using (public.is_approved());

drop policy if exists "members add inventory" on public.chemicals;
create policy "members add inventory"
  on public.chemicals for insert
  to authenticated
  with check (public.is_approved() and public.current_user_role() in ('admin', 'member'));

drop policy if exists "members edit inventory" on public.chemicals;
create policy "members edit inventory"
  on public.chemicals for update
  to authenticated
  using (public.is_approved() and public.current_user_role() in ('admin', 'member'))
  with check (public.is_approved() and public.current_user_role() in ('admin', 'member'));

-- Deleting is deliberately narrow: the person who registered the container, or
-- an admin. Everyone else marks it `empty`, which keeps the history intact.
drop policy if exists "owners and admins delete inventory" on public.chemicals;
create policy "owners and admins delete inventory"
  on public.chemicals for delete
  to authenticated
  using (
    public.is_approved()
    and (public.current_user_role() = 'admin' or created_by = (select auth.uid()))
  );

-- delivery-photos storage bucket ---------------------------------------------
-- A photo of the delivery order/invoice for a container, purely for
-- reference — never parsed automatically without a person confirming what to
-- keep. Private (not `public`): a photo can show pricing, so it's gated by
-- the same approval check as everything else, not "unlisted but guessable."
insert into storage.buckets (id, name, public)
values ('delivery-photos', 'delivery-photos', false)
on conflict (id) do nothing;

drop policy if exists "approved users manage delivery photos" on storage.objects;
create policy "approved users manage delivery photos"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'delivery-photos' and public.is_approved())
  with check (bucket_id = 'delivery-photos' and public.is_approved());

-- activity_log --------------------------------------------------------------
-- Same gate: the audit trail names people and describes what changed, which
-- an unapproved account has no business reading either.
drop policy if exists "activity readable by signed-in users" on public.activity_log;
create policy "activity readable by signed-in users"
  on public.activity_log for select
  to authenticated
  using (public.is_approved());

drop policy if exists "signed-in users append activity" on public.activity_log;
create policy "signed-in users append activity"
  on public.activity_log for insert
  to authenticated
  with check (public.is_approved() and user_id = (select auth.uid()));
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
  group by 1
  order by 2 desc;
