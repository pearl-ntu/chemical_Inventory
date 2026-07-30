-- Incident / near-miss reporting ---------------------------------------------
-- Safety reporting shouldn't be gated by permission level — any approved
-- member, including a viewer-only account, can file one.
create table if not exists public.incident_reports (
  id            uuid primary key default gen_random_uuid(),
  reported_by   uuid references public.profiles(id) on delete set null,
  reported_by_name text,
  resource_type text check (resource_type in ('chemical', 'equipment', 'other')),
  resource_id   uuid,
  severity      text not null default 'near_miss' check (severity in ('near_miss', 'minor', 'major')),
  description   text not null,
  occurred_at   timestamptz not null default now(),
  actions_taken text,
  created_at    timestamptz not null default now()
);

create index if not exists incident_reports_created_idx on public.incident_reports (created_at desc);
alter table public.incident_reports enable row level security;

drop policy if exists "incident reports readable by approved users" on public.incident_reports;
create policy "incident reports readable by approved users"
  on public.incident_reports for select
  to authenticated
  using (public.is_approved());

drop policy if exists "any approved member can file an incident report" on public.incident_reports;
create policy "any approved member can file an incident report"
  on public.incident_reports for insert
  to authenticated
  with check (public.is_approved() and reported_by = (select auth.uid()));

drop policy if exists "authors and admins edit incident reports" on public.incident_reports;
create policy "authors and admins edit incident reports"
  on public.incident_reports for update
  to authenticated
  using (public.is_approved() and (reported_by = (select auth.uid()) or public.current_user_role() = 'admin'));

drop policy if exists "authors and admins delete incident reports" on public.incident_reports;
create policy "authors and admins delete incident reports"
  on public.incident_reports for delete
  to authenticated
  using (public.is_approved() and (reported_by = (select auth.uid()) or public.current_user_role() = 'admin'));

-- Notify every admin/PI in-app. Deliberately just the notifications insert,
-- not a direct Teams call too — the teams_on_notification trigger (Round 6
-- Teams migration) already cross-posts every row inserted here, so calling
-- notify_teams_async again from this function would double-post.
create or replace function public.notify_on_incident_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (recipient_id, actor_id, actor_name, message)
  select p.id, new.reported_by, new.reported_by_name,
         format('New %s incident report: %s', new.severity, left(new.description, 140))
  from public.profiles p
  where p.approved and (p.role = 'admin' or p.is_pi);

  return new;
end;
$$;

drop trigger if exists notify_on_incident_report on public.incident_reports;
create trigger notify_on_incident_report
  after insert on public.incident_reports
  for each row
  execute function public.notify_on_incident_report();

notify pgrst, 'reload schema';
