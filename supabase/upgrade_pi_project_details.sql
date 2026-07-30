-- A short description on a project — surfaced in the PI console so a
-- project isn't just a name and a status log.
alter table public.projects add column if not exists description text;

notify pgrst, 'reload schema';
