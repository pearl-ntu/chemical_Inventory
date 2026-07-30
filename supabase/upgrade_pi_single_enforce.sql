-- Only one PI at a time -----------------------------------------------------
--
-- Granting PI to someone new must demote whoever had it before — a lab has
-- one PI, not a set of them. Extends the existing guard_is_pi_change trigger
-- (which already restricts *who* can flip the flag) to also enforce *how
-- many* can be true at once, and backstops it with a unique partial index
-- so this holds even if something writes to the table outside this trigger.
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

  if new.is_pi and not old.is_pi then
    update public.profiles set is_pi = false where id <> new.id and is_pi;
  end if;

  return new;
end;
$$;

create unique index if not exists profiles_single_pi_idx on public.profiles ((is_pi)) where is_pi;

notify pgrst, 'reload schema';
