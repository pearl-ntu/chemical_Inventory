-- Protect the PEARL developer account from accidental or malicious admin/PI
-- revocation. Run this in Supabase SQL Editor.

create or replace function public.guard_pearl_developer_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  developer_email constant text := 'abedisyedaliabbas@gmail.com';
begin
  if tg_op = 'DELETE' and lower(old.email) = developer_email then
    raise exception 'The PEARL developer account cannot be deleted.';
  end if;

  if tg_op = 'UPDATE' and lower(old.email) = developer_email then
    if auth.uid() is distinct from old.id and (
      new.email is distinct from old.email or
      new.role is distinct from old.role or
      new.approved is distinct from old.approved or
      new.is_pi is distinct from old.is_pi
    ) then
      raise exception 'The PEARL developer account cannot be changed by another account.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_pearl_developer_profile_update on public.profiles;
create trigger guard_pearl_developer_profile_update
  before update on public.profiles
  for each row
  execute function public.guard_pearl_developer_profile();

drop trigger if exists guard_pearl_developer_profile_delete on public.profiles;
create trigger guard_pearl_developer_profile_delete
  before delete on public.profiles
  for each row
  execute function public.guard_pearl_developer_profile();

notify pgrst, 'reload schema';
