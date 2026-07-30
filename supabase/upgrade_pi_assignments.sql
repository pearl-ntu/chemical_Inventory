-- Lock down who can grant PI status --------------------------------------
--
-- profiles already has an update policy that lets any admin edit anyone's
-- row (role changes, approvals, etc.) — RLS can't restrict that to "every
-- column except is_pi", so a trigger does it instead: changing `is_pi`
-- itself requires the *actor* to already be PI. A plain admin can still
-- update every other profile field exactly as before.
create or replace function public.guard_is_pi_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_pi is distinct from old.is_pi and not public.is_pi() then
    raise exception 'Only an existing PI can grant or revoke PI access.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_is_pi_change on public.profiles;
create trigger guard_is_pi_change
  before update on public.profiles
  for each row
  execute function public.guard_is_pi_change();

-- project_members ------------------------------------------------------------
-- Explicit "who's assigned to this project" — separate from project_updates'
-- author list, since a PI assigning someone to a project is a decision, not
-- an inference from who happened to post an update.
create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);

alter table public.project_members enable row level security;

drop policy if exists "project members readable by approved users" on public.project_members;
create policy "project members readable by approved users"
  on public.project_members for select
  to authenticated
  using (public.is_approved());

drop policy if exists "pi and admins assign project members" on public.project_members;
create policy "pi and admins assign project members"
  on public.project_members for insert
  to authenticated
  with check (
    public.is_approved()
    and (public.is_pi() or public.current_user_role() = 'admin')
  );

drop policy if exists "pi and admins remove project members" on public.project_members;
create policy "pi and admins remove project members"
  on public.project_members for delete
  to authenticated
  using (
    public.is_approved()
    and (public.is_pi() or public.current_user_role() = 'admin')
  );

notify pgrst, 'reload schema';
