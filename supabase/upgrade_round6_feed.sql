-- Global lab feed ------------------------------------------------------------
-- Free-form, lab-wide, visible regardless of Experimental/Computational
-- workspace — the same way Members and Settings already sit outside that
-- toggle. Any approved member (any role, including viewer) can post and
-- like; the comments table is reused for replies rather than a second
-- comment system.
create table if not exists public.feed_posts (
  id                   uuid primary key default gen_random_uuid(),
  author_id            uuid references public.profiles(id) on delete set null,
  author_name          text,
  body                 text not null,
  image_url            text,
  linked_resource_type text check (linked_resource_type in ('chemical', 'research_asset', 'project')),
  linked_resource_id   uuid,
  cross_post_to_teams  boolean not null default false,
  created_at           timestamptz not null default now()
);

create index if not exists feed_posts_created_idx on public.feed_posts (created_at desc);
alter table public.feed_posts enable row level security;

drop policy if exists "feed posts readable by approved users" on public.feed_posts;
create policy "feed posts readable by approved users"
  on public.feed_posts for select
  to authenticated
  using (public.is_approved());

drop policy if exists "any approved member can post to the feed" on public.feed_posts;
create policy "any approved member can post to the feed"
  on public.feed_posts for insert
  to authenticated
  with check (public.is_approved() and author_id = (select auth.uid()));

drop policy if exists "authors and admins delete feed posts" on public.feed_posts;
create policy "authors and admins delete feed posts"
  on public.feed_posts for delete
  to authenticated
  using (public.is_approved() and (author_id = (select auth.uid()) or public.current_user_role() = 'admin'));

-- feed_post_likes -------------------------------------------------------------
create table if not exists public.feed_post_likes (
  post_id    uuid not null references public.feed_posts(id) on delete cascade,
  member_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, member_id)
);

alter table public.feed_post_likes enable row level security;

drop policy if exists "likes readable by approved users" on public.feed_post_likes;
create policy "likes readable by approved users"
  on public.feed_post_likes for select
  to authenticated
  using (public.is_approved());

drop policy if exists "approved members can like" on public.feed_post_likes;
create policy "approved members can like"
  on public.feed_post_likes for insert
  to authenticated
  with check (public.is_approved() and member_id = (select auth.uid()));

drop policy if exists "members can unlike their own like" on public.feed_post_likes;
create policy "members can unlike their own like"
  on public.feed_post_likes for delete
  to authenticated
  using (member_id = (select auth.uid()));

-- Reuse the existing comments table for replies on a post.
alter table public.comments drop constraint if exists comments_resource_type_check;
alter table public.comments add constraint comments_resource_type_check
  check (resource_type in ('chemical', 'research_asset', 'equipment_booking', 'project', 'feed_post'));

drop policy if exists "comments readable by parent visibility" on public.comments;
create policy "comments readable by parent visibility"
  on public.comments for select
  to authenticated
  using (
    public.is_approved()
    and (
      resource_type in ('chemical', 'equipment_booking', 'project', 'feed_post')
      or exists (
        select 1 from public.research_assets asset
        where asset.id = resource_id and asset.created_by = (select auth.uid())
      )
    )
  );

-- Cross-post to Teams when flagged, using the Round 6 Teams helper (a
-- no-op if that migration hasn't been run yet).
create or replace function public.teams_on_feed_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cross_post_to_teams and exists (select 1 from pg_proc where proname = 'notify_teams_async') then
    perform public.notify_teams_async(format('%s posted to the feed: %s', coalesce(new.author_name, 'Someone'), left(new.body, 200)));
  end if;
  return new;
end;
$$;

drop trigger if exists teams_on_feed_post on public.feed_posts;
create trigger teams_on_feed_post
  after insert on public.feed_posts
  for each row
  execute function public.teams_on_feed_post();

-- feed-images storage bucket ---------------------------------------------------
-- Private, same reasoning as delivery-photos/lab-documents — approved-only,
-- signed URLs minted per view rather than a public bucket.
insert into storage.buckets (id, name, public)
values ('feed-images', 'feed-images', false)
on conflict (id) do nothing;

drop policy if exists "approved users manage feed images" on storage.objects;
create policy "approved users manage feed images"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'feed-images' and public.is_approved())
  with check (bucket_id = 'feed-images' and public.is_approved());

notify pgrst, 'reload schema';
