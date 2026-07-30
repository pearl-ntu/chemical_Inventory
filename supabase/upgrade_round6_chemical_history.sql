-- Chemical history — a real before/after view, not "read the activity log
-- and infer what changed." Populated entirely server-side by a trigger, so
-- it can't drift from what actually happened and the client never has to
-- compute (or forget to compute) a diff.
create table if not exists public.chemical_history (
  id              uuid primary key default gen_random_uuid(),
  chemical_id     uuid not null references public.chemicals(id) on delete cascade,
  changed_by      uuid references auth.users on delete set null,
  changed_by_name text,
  changed_at      timestamptz not null default now(),
  diff            jsonb not null
);

create index if not exists chemical_history_chemical_idx on public.chemical_history (chemical_id, changed_at desc);
alter table public.chemical_history enable row level security;

drop policy if exists "chemical history readable by approved users" on public.chemical_history;
create policy "chemical history readable by approved users"
  on public.chemical_history for select
  to authenticated
  using (public.is_approved());

-- No insert/update/delete policy for `authenticated` — the only writer is
-- the trigger below, which runs as the function owner (bypasses RLS the
-- same way every other SECURITY DEFINER trigger in this schema does).

create or replace function public.record_chemical_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  key text;
  computed_diff jsonb := '{}'::jsonb;
  -- Never worth a history row on its own — these change on every save
  -- regardless of whether anything meaningful actually did.
  ignore_cols text[] := array['updated_at'];
begin
  for key in select jsonb_object_keys(new_j) loop
    if key = any(ignore_cols) then
      continue;
    end if;
    if (old_j -> key) is distinct from (new_j -> key) then
      computed_diff := computed_diff || jsonb_build_object(key, jsonb_build_object('old', old_j -> key, 'new', new_j -> key));
    end if;
  end loop;

  if computed_diff <> '{}'::jsonb then
    insert into public.chemical_history (chemical_id, changed_by, changed_by_name, diff)
    values (
      new.id,
      auth.uid(),
      (select full_name from public.profiles where id = auth.uid()),
      computed_diff
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_chemical_history on public.chemicals;
create trigger record_chemical_history
  after update on public.chemicals
  for each row
  execute function public.record_chemical_history();

notify pgrst, 'reload schema';
