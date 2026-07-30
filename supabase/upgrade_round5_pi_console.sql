-- Round 5 — PI Console command-center upgrade -----------------------------
--
-- Extends the existing projects/comments/notifications infrastructure
-- (is_pi(), project_members, comments with resource_type='project') rather
-- than duplicating it. Two new tables: project_milestones (public, a
-- lightweight per-project task list) and pi_notes (strictly admin-only —
-- see the RLS comments below for the one subtlety that matters).

alter table public.projects add column if not exists status text not null default 'active'
  check (status in ('active', 'on_hold', 'completed', 'archived'));
alter table public.projects add column if not exists target_date date;
alter table public.projects add column if not exists budget_amount numeric;

-- Keep the existing `archived` boolean and the new `status` enum in sync
-- going forward — application code sets both together, but this backstops
-- it in case anything ever writes just one.
create or replace function public.sync_project_archived_status()
returns trigger
language plpgsql
as $$
begin
  if new.archived and new.status <> 'archived' then
    new.status := 'archived';
  elsif not new.archived and new.status = 'archived' then
    new.status := 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_archived_status on public.projects;
create trigger sync_project_archived_status
  before insert or update on public.projects
  for each row
  execute function public.sync_project_archived_status();

-- project_milestones ----------------------------------------------------------
-- A lightweight per-project task list — three statuses, an optional
-- assignee and due date, nothing more. Readable lab-wide (same transparency
-- as project_updates); writable by admin/PI, or by the assignee themselves
-- so they can move their own card without needing PI involvement.
create table if not exists public.project_milestones (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  title              text not null,
  status             text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  assignee_member_id uuid references public.profiles(id) on delete set null,
  due_date           date,
  created_at         timestamptz not null default now()
);

create index if not exists project_milestones_project_idx on public.project_milestones (project_id);
alter table public.project_milestones enable row level security;

drop policy if exists "milestones readable by approved users" on public.project_milestones;
create policy "milestones readable by approved users"
  on public.project_milestones for select
  to authenticated
  using (public.is_approved());

drop policy if exists "admins and pi create milestones" on public.project_milestones;
create policy "admins and pi create milestones"
  on public.project_milestones for insert
  to authenticated
  with check (public.is_approved() and (public.current_user_role() = 'admin' or public.is_pi()));

drop policy if exists "admins pi and assignee update milestones" on public.project_milestones;
create policy "admins pi and assignee update milestones"
  on public.project_milestones for update
  to authenticated
  using (
    public.is_approved()
    and (public.current_user_role() = 'admin' or public.is_pi() or assignee_member_id = (select auth.uid()))
  );

drop policy if exists "admins and pi delete milestones" on public.project_milestones;
create policy "admins and pi delete milestones"
  on public.project_milestones for delete
  to authenticated
  using (public.is_approved() and (public.current_user_role() = 'admin' or public.is_pi()));

-- pi_notes ----------------------------------------------------------------------
-- Private supervision notes about a member — the one place in this whole
-- feature where a mistake would actually leak something sensitive, so the
-- select policy is deliberately stricter than "is admin": an admin who is
-- ALSO the member the note is about must not be able to read it about
-- themselves. member_id <> auth.uid() closes that loophole explicitly
-- rather than relying on nobody ever writing a note about an admin.
create table if not exists public.pi_notes (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  author_name text,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists pi_notes_member_idx on public.pi_notes (member_id, created_at desc);
alter table public.pi_notes enable row level security;

drop policy if exists "admins read notes not about themselves" on public.pi_notes;
create policy "admins read notes not about themselves"
  on public.pi_notes for select
  to authenticated
  using (
    public.is_approved()
    and public.current_user_role() = 'admin'
    and member_id <> (select auth.uid())
  );

drop policy if exists "admins write notes not about themselves" on public.pi_notes;
create policy "admins write notes not about themselves"
  on public.pi_notes for insert
  to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() = 'admin'
    and author_id = (select auth.uid())
    and member_id <> (select auth.uid())
  );

drop policy if exists "authors delete their own notes" on public.pi_notes;
create policy "authors delete their own notes"
  on public.pi_notes for delete
  to authenticated
  using (
    public.is_approved()
    and public.current_user_role() = 'admin'
    and author_id = (select auth.uid())
  );

notify pgrst, 'reload schema';
