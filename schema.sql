-- BSL Sign Stories: database setup for Supabase
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- It is safe to run once on a new project.

-- ---------------------------------------------------------------
-- People
-- ---------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 60),
  signer_is     text not null default '' check (char_length(signer_is) <= 60),
  over_16       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- People who can approve, hide and review posts.
create table public.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.is_moderator()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.moderators where user_id = auth.uid()) $$;

-- ---------------------------------------------------------------
-- Content. Every post starts as 'pending' and appears publicly once
-- a moderator approves it. Authors always see their own posts.
-- ---------------------------------------------------------------
create table public.signs (
  id          uuid primary key default gen_random_uuid(),
  gloss       text not null check (char_length(gloss) between 1 and 60),
  meaning     text not null default '' check (char_length(meaning) <= 200),
  region      text not null default '' check (char_length(region) <= 60),
  status      text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.versions (
  id           uuid primary key default gen_random_uuid(),
  sign_id      uuid not null references public.signs(id) on delete cascade,
  kind         text not null check (kind in ('video','image','link','text')),
  media_path   text check (media_path is null or char_length(media_path) <= 300),
  url          text not null default '' check (char_length(url) <= 1000),
  description  text not null default '' check (char_length(description) <= 2000),
  status       text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_by   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check (kind <> 'link' or url ~* '^https?://'),
  check (kind not in ('video','image') or media_path is not null),
  check (kind <> 'text' or char_length(description) > 0)
);

create table public.stories (
  id          uuid primary key default gen_random_uuid(),
  sign_id     uuid not null references public.signs(id) on delete cascade,
  kind        text not null check (kind in ('documented','community','personal','disputed')),
  body        text not null default '' check (char_length(body) <= 6000),
  video_path  text check (video_path is null or char_length(video_path) <= 300),
  link        text not null default '' check (link = '' or link ~* '^https?://'),
  hook        text not null default '' check (char_length(hook) <= 240),
  source      text not null default '' check (char_length(source) <= 300),
  status      text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (char_length(body) > 0 or video_path is not null or link <> '')
);

-- Panel review marks on origin stories.
create table public.reviews (
  story_id     uuid primary key references public.stories(id) on delete cascade,
  reviewed_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reviewed_at  timestamptz not null default now()
);

-- One confirmation per person per item.
create table public.confirmations (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_type  text not null check (item_type in ('version','story')),
  item_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

-- Public totals, without exposing who confirmed what.
create view public.confirmation_counts as
  select item_type, item_id, count(*)::int as n
  from public.confirmations group by item_type, item_id;

-- ---------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------
-- New posts are always pending unless a moderator posts them,
-- and nobody can set someone else as the author.
create or replace function public.guard_new_post()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  if not public.is_moderator() then
    new.status := 'pending';
  end if;
  return new;
end $$;

create trigger signs_guard    before insert on public.signs    for each row execute function public.guard_new_post();
create trigger versions_guard before insert on public.versions for each row execute function public.guard_new_post();
create trigger stories_guard  before insert on public.stories  for each row execute function public.guard_new_post();

-- Only moderators can change a post after it is made (approve, hide, edit).
create or replace function public.guard_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can change posts';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger signs_update    before update on public.signs    for each row execute function public.guard_update();
create trigger versions_update before update on public.versions for each row execute function public.guard_update();
create trigger stories_update  before update on public.stories  for each row execute function public.guard_update();

-- Confirmations must point at a real, approved item that isn't your own.
create or replace function public.guard_confirmation()
returns trigger language plpgsql security definer set search_path = public
as $$
declare author uuid; st text;
begin
  new.user_id := auth.uid();
  if new.item_type = 'version' then
    select created_by, status into author, st from public.versions where id = new.item_id;
  else
    select created_by, status into author, st from public.stories where id = new.item_id;
  end if;
  if author is null then raise exception 'That item does not exist'; end if;
  if st <> 'approved' then raise exception 'Only approved items can be confirmed'; end if;
  if author = auth.uid() then raise exception 'You cannot confirm your own post'; end if;
  return new;
end $$;

create trigger confirmations_guard before insert on public.confirmations
  for each row execute function public.guard_confirmation();

-- Tidy confirmations when a version or story is deleted.
create or replace function public.drop_confirmations()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.confirmations
   where item_id = old.id
     and item_type = case when tg_table_name = 'versions' then 'version' else 'story' end;
  return old;
end $$;

create trigger versions_drop_conf after delete on public.versions for each row execute function public.drop_confirmations();
create trigger stories_drop_conf  after delete on public.stories  for each row execute function public.drop_confirmations();

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.moderators    enable row level security;
alter table public.signs         enable row level security;
alter table public.versions      enable row level security;
alter table public.stories       enable row level security;
alter table public.reviews       enable row level security;
alter table public.confirmations enable row level security;

-- Profiles: names are public so posts can be credited; you edit only your own.
create policy "profiles readable"   on public.profiles for select using (true);
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Moderators: you can see whether you are one.
create policy "moderators see self" on public.moderators for select to authenticated using (user_id = auth.uid());

-- Content: approved posts are public; authors and moderators see the rest.
-- Posting requires a profile with the over-16 box ticked.
create policy "signs read"    on public.signs    for select using (status = 'approved' or created_by = auth.uid() or public.is_moderator());
create policy "versions read" on public.versions for select using (status = 'approved' or created_by = auth.uid() or public.is_moderator());
create policy "stories read"  on public.stories  for select using (status = 'approved' or created_by = auth.uid() or public.is_moderator());

create policy "signs insert"    on public.signs    for insert to authenticated with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.over_16));
create policy "versions insert" on public.versions for insert to authenticated with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.over_16));
create policy "stories insert"  on public.stories  for insert to authenticated with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.over_16));

create policy "signs moderate"    on public.signs    for update to authenticated using (public.is_moderator());
create policy "versions moderate" on public.versions for update to authenticated using (public.is_moderator());
create policy "stories moderate"  on public.stories  for update to authenticated using (public.is_moderator());

-- Authors can remove their own sign only while nobody else has added to it.
create or replace function public.sign_has_others(sid uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.versions where sign_id = sid and created_by <> auth.uid())
      or exists (select 1 from public.stories  where sign_id = sid and created_by <> auth.uid())
$$;
create policy "signs delete"    on public.signs    for delete to authenticated using ((created_by = auth.uid() and not public.sign_has_others(id)) or public.is_moderator());
create policy "versions delete" on public.versions for delete to authenticated using (created_by = auth.uid() or public.is_moderator());
create policy "stories delete"  on public.stories  for delete to authenticated using (created_by = auth.uid() or public.is_moderator());

-- Reviews: public; only moderators add or remove them.
create policy "reviews read"   on public.reviews for select using (true);
create policy "reviews add"    on public.reviews for insert to authenticated with check (public.is_moderator());
create policy "reviews remove" on public.reviews for delete to authenticated using (public.is_moderator());

-- Confirmations: you see and manage only your own; totals come from the view.
create policy "confirmations own read"   on public.confirmations for select to authenticated using (user_id = auth.uid());
create policy "confirmations own add"    on public.confirmations for insert to authenticated with check (user_id = auth.uid());
create policy "confirmations own remove" on public.confirmations for delete to authenticated using (user_id = auth.uid());

grant select on public.confirmation_counts to anon, authenticated;

-- ---------------------------------------------------------------
-- File storage for uploaded videos and images
-- Files go in a folder named after the uploader's id.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 20971520,
        array['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media delete own or moderator" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_moderator()));

-- ---------------------------------------------------------------
-- Posting without an account (Supabase anonymous sign-ins)
-- Turn on: Authentication > Sign In / Providers > Allow anonymous sign-ins
-- ---------------------------------------------------------------
alter table public.profiles add column if not exists anonymous boolean not null default false;

create or replace function public.set_profile_anonymous()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.anonymous := coalesce((auth.jwt()->>'is_anonymous')::boolean, false);
  return new;
end $$;
revoke execute on function public.set_profile_anonymous() from public, anon, authenticated;

create trigger profiles_anonymous before insert or update on public.profiles
  for each row execute function public.set_profile_anonymous();

-- Confirmations need an email account.
drop policy if exists "confirmations own add" on public.confirmations;
create policy "confirmations own add" on public.confirmations for insert to authenticated
  with check (user_id = auth.uid() and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false));
