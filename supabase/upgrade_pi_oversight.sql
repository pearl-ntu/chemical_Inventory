-- PI oversight layer -----------------------------------------------------
--
-- Rather than rewriting every existing "admin-only" policy in this schema to
-- also recognise a new role value (a real risk to get subtly wrong across
-- dozens of already-live policies), a PI's access is layered on top of the
-- existing role system: a PI keeps `role = 'admin'` — so every admin power
-- already wired up just works — plus a separate `is_pi` flag that unlocks
-- the new oversight dashboard, project comments, and pings. Nothing about
-- the existing admin/member/viewer policies changes.
--
-- To make the first PI account: after running this file,
--   update public.profiles set role = 'admin', is_pi = true where email = '...';

alter table public.profiles add column if not exists is_pi boolean not null default false;

create or replace function public.is_pi()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_pi from public.profiles where id = (select auth.uid())), false);
$$;

revoke execute on function public.is_pi() from public;
grant execute on function public.is_pi() to authenticated;

-- projects ------------------------------------------------------------------
-- A lightweight registry of project names — just enough structure to hang a
-- weekly status log and comments off, without replacing the free-text
-- `project` field already used on chemicals/research_assets.
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  workspace   text not null default 'both' check (workspace in ('experimental', 'computational', 'both')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  archived    boolean not null default false
);

create unique index if not exists projects_name_idx on public.projects (lower(name));
alter table public.projects enable row level security;

drop policy if exists "projects readable by approved users" on public.projects;
create policy "projects readable by approved users"
  on public.projects for select
  to authenticated
  using (public.is_approved());

drop policy if exists "members create projects" on public.projects;
create policy "members create projects"
  on public.projects for insert
  to authenticated
  with check (
    public.is_approved()
    and (public.current_user_role() in ('admin', 'member') or public.is_pi())
  );

drop policy if exists "owners and admins manage projects" on public.projects;
create policy "owners and admins manage projects"
  on public.projects for update
  to authenticated
  using (
    public.is_approved()
    and (created_by = (select auth.uid()) or public.current_user_role() = 'admin' or public.is_pi())
  );

drop policy if exists "owners and admins delete projects" on public.projects;
create policy "owners and admins delete projects"
  on public.projects for delete
  to authenticated
  using (
    public.is_approved()
    and (created_by = (select auth.uid()) or public.current_user_role() = 'admin' or public.is_pi())
  );

-- project_updates -------------------------------------------------------------
-- The actual "what I did this week / what's pending / what's blocked" log —
-- the whole point of the feature. Readable by everyone approved (same
-- transparency as the rest of the app), postable by anyone who isn't a
-- viewer, editable/removable only by its author or an admin/PI.
create table if not exists public.project_updates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  status      text not null default 'on_track' check (status in ('on_track', 'blocked', 'done', 'paused')),
  summary     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists project_updates_project_idx on public.project_updates (project_id, created_at desc);
alter table public.project_updates enable row level security;

drop policy if exists "project updates readable by approved users" on public.project_updates;
create policy "project updates readable by approved users"
  on public.project_updates for select
  to authenticated
  using (public.is_approved());

drop policy if exists "members post project updates" on public.project_updates;
create policy "members post project updates"
  on public.project_updates for insert
  to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and author_id = (select auth.uid())
  );

drop policy if exists "authors and admins manage project updates" on public.project_updates;
create policy "authors and admins manage project updates"
  on public.project_updates for update
  to authenticated
  using (
    public.is_approved()
    and (author_id = (select auth.uid()) or public.current_user_role() = 'admin' or public.is_pi())
  );

drop policy if exists "authors and admins delete project updates" on public.project_updates;
create policy "authors and admins delete project updates"
  on public.project_updates for delete
  to authenticated
  using (
    public.is_approved()
    and (author_id = (select auth.uid()) or public.current_user_role() = 'admin' or public.is_pi())
  );

-- Let PI/admin comments attach to a project, reusing the existing generic
-- comments table (chemicals/research assets/equipment bookings already use
-- it) instead of a parallel comments system.
alter table public.comments drop constraint if exists comments_resource_type_check;
alter table public.comments add constraint comments_resource_type_check
  check (resource_type in ('chemical', 'research_asset', 'equipment_booking', 'project'));

drop policy if exists "comments readable by parent visibility" on public.comments;
create policy "comments readable by parent visibility"
  on public.comments for select
  to authenticated
  using (
    public.is_approved()
    and (
      resource_type in ('chemical', 'equipment_booking', 'project')
      or exists (
        select 1 from public.research_assets asset
        where asset.id = resource_id and asset.created_by = (select auth.uid())
      )
    )
  );

-- notifications ---------------------------------------------------------------
-- The "ping": in-app only for now, no email/Slack dependency. A row is
-- addressed to exactly one recipient and is only ever visible to them.
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text,
  project_id   uuid references public.projects(id) on delete cascade,
  message      text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists "recipients read own notifications" on public.notifications;
create policy "recipients read own notifications"
  on public.notifications for select
  to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists "approved users send notifications" on public.notifications;
create policy "approved users send notifications"
  on public.notifications for insert
  to authenticated
  with check (
    public.is_approved()
    and (actor_id = (select auth.uid()) or actor_id is null)
  );

drop policy if exists "recipients update own notifications" on public.notifications;
create policy "recipients update own notifications"
  on public.notifications for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

drop policy if exists "recipients delete own notifications" on public.notifications;
create policy "recipients delete own notifications"
  on public.notifications for delete
  to authenticated
  using (recipient_id = (select auth.uid()));

notify pgrst, 'reload schema';
