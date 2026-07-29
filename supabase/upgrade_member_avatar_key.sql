alter table public.profiles
  add column if not exists avatar_key text;

notify pgrst, 'reload schema';
