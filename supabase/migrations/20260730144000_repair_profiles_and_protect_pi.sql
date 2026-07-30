-- Repair the Auth -> profile bridge and protect PI access at the database
-- boundary. UI checks are helpful guidance, but these triggers are the
-- authoritative safeguards for direct API calls and future clients.

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
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    case when is_first then 'admin' else 'viewer' end,
    is_first,
    new.encrypted_password is not null and new.encrypted_password <> ''
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

create or replace function public.guard_is_pi_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_is_pi boolean := public.is_pi();
begin
  if old.is_pi
     and not actor_is_pi
     and (
       new.role is distinct from old.role
       or new.approved is distinct from old.approved
       or new.is_pi is distinct from old.is_pi
     )
  then
    raise exception 'Only the PI can change or revoke the PI account''s access.'
      using errcode = '42501';
  end if;

  if new.is_pi is distinct from old.is_pi and not actor_is_pi then
    raise exception 'Only an existing PI can grant or revoke PI access.'
      using errcode = '42501';
  end if;

  if new.is_pi and not old.is_pi then
    update public.profiles
    set is_pi = false
    where id <> new.id and is_pi;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_is_pi_change() from public, anon, authenticated;

drop trigger if exists guard_is_pi_change on public.profiles;
create trigger guard_is_pi_change
  before update on public.profiles
  for each row
  execute function public.guard_is_pi_change();

create or replace function public.guard_pi_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_pi and not public.is_pi() then
    raise exception 'Only the PI can delete the PI account.'
      using errcode = '42501';
  end if;

  return old;
end;
$$;

revoke execute on function public.guard_pi_delete() from public, anon, authenticated;

drop trigger if exists guard_pi_delete on public.profiles;
create trigger guard_pi_delete
  before delete on public.profiles
  for each row
  execute function public.guard_pi_delete();

notify pgrst, 'reload schema';
