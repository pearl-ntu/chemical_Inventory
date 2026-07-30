-- Round 6 — Microsoft Teams notifications ----------------------------------
--
-- Fires server-side via pg_net + Postgres triggers, not client-side JS —
-- so a Teams post can never be skipped just because someone closed the tab
-- before an action finished, and the actual webhook URL (a bearer secret)
-- never has to touch the browser.
--
-- Before running this file:
--   1. Create the Teams Workflow ("Post to a channel when a webhook
--      request is received") and deploy notify-teams:
--        supabase functions deploy notify-teams
--   2. Set its secret:
--        supabase secrets set TEAMS_WEBHOOK_URL=https://...
--   3. Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> below — this file is a
--      local template, not meant to be committed with real values filled in.

create extension if not exists pg_net;

-- One shared helper — every trigger below just calls this, so the
-- project ref/service key only needs filling in once, not once per trigger.
-- Failures are swallowed (never let a Teams outage block the real insert).
create or replace function public.notify_teams_async(message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-teams',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('message', message)
  );
exception when others then
  null;
end;
$$;

-- New chemical purchase request ----------------------------------------------
create or replace function public.teams_on_chemical_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_teams_async(
    format('New chemical request: %s%s%s', new.chemical_name_or_cas,
      case when new.quantity is not null then format(' (qty: %s)', new.quantity) else '' end,
      case when new.requested_by_name is not null then format(' — requested by %s', new.requested_by_name) else '' end)
  );
  return new;
end;
$$;

drop trigger if exists teams_on_chemical_request on public.chemical_requests;
create trigger teams_on_chemical_request
  after insert on public.chemical_requests
  for each row
  execute function public.teams_on_chemical_request();

-- New member awaiting approval ------------------------------------------------
create or replace function public.teams_on_pending_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.approved then
    perform public.notify_teams_async(format('New sign-up waiting for approval: %s (%s)', new.full_name, new.email));
  end if;
  return new;
end;
$$;

drop trigger if exists teams_on_pending_approval on public.profiles;
create trigger teams_on_pending_approval
  after insert on public.profiles
  for each row
  execute function public.teams_on_pending_approval();

-- Mentions and PI-reply pings (existing notifications table) -----------------
create or replace function public.teams_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_teams_async(
    format('%s: %s', coalesce(new.actor_name, 'PEARL'), new.message)
  );
  return new;
end;
$$;

drop trigger if exists teams_on_notification on public.notifications;
create trigger teams_on_notification
  after insert on public.notifications
  for each row
  execute function public.teams_on_notification();
