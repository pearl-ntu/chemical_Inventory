-- ===========================================================================
-- PEARL privacy patch: computational assets are private per user.
--
-- Run this once in Supabase SQL Editor after the computational tables exist.
-- It does not touch chemical inventory sharing.
-- ===========================================================================

alter table public.research_assets
  alter column visibility set default 'private';

update public.research_assets
set visibility = 'private'
where visibility is null or visibility <> 'private';

alter table public.research_assets
  drop constraint if exists research_assets_visibility_check;

alter table public.research_assets
  add constraint research_assets_visibility_check check (visibility = 'private');

drop policy if exists "activity readable by signed-in users" on public.activity_log;
create policy "activity readable by signed-in users"
  on public.activity_log for select
  to authenticated
  using (
    public.is_approved()
    and (
      details is null
      or details !~* 'research asset'
      or user_id = (select auth.uid())
    )
  );

drop policy if exists "research assets readable by approved users" on public.research_assets;
create policy "research assets readable by approved users"
  on public.research_assets for select
  to authenticated
  using (
    public.is_approved()
    and created_by = (select auth.uid())
  );

drop policy if exists "members add research assets" on public.research_assets;
create policy "members add research assets"
  on public.research_assets for insert
  to authenticated
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and visibility = 'private'
    and created_by = (select auth.uid())
  );

drop policy if exists "members edit research assets" on public.research_assets;
create policy "members edit research assets"
  on public.research_assets for update
  to authenticated
  using (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and created_by = (select auth.uid())
  )
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and visibility = 'private'
    and created_by = (select auth.uid())
  );

drop policy if exists "owners and admins delete research assets" on public.research_assets;
create policy "owners and admins delete research assets"
  on public.research_assets for delete
  to authenticated
  using (
    public.is_approved()
    and created_by = (select auth.uid())
  );

drop policy if exists "research asset links readable by approved users" on public.research_asset_chemicals;
create policy "research asset links readable by approved users"
  on public.research_asset_chemicals for select
  to authenticated
  using (
    public.is_approved()
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  );

drop policy if exists "members manage research asset links" on public.research_asset_chemicals;
create policy "members manage research asset links"
  on public.research_asset_chemicals for all
  to authenticated
  using (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  )
  with check (
    public.is_approved()
    and public.current_user_role() in ('admin', 'member')
    and exists (
      select 1
      from public.research_assets asset
      where asset.id = research_asset_id
        and asset.created_by = (select auth.uid())
    )
  );

notify pgrst, 'reload schema';
