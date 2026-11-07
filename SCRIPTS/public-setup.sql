-- ChalkBored PUBLIC: the whole database (Requests poll, people online, and
-- Class chat at the bottom).
-- Supabase project "ChalkBored Public" (thrwgeuljtqjfcohzfdt), not the private
-- Chalk Chat one. Requests and the online count need no account: each browser
-- makes a random id (localStorage "chalk-device") and sends it with each call.
-- Only Class chat has accounts.
--
-- Paste into SQL Editor and run. Safe to run again.
--
-- Poll options are added here by hand (there are no moderators to sign in):
--   insert into requests (title, reason, kind) values ('Name', 'One line', 'game');
--   update requests set status = 'added' where id = 3;   -- open | planned | added | declined
--   update requests set hidden = true where id = 3;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.requests (
  id         bigserial primary key,
  title      text not null check (char_length(title) between 3 and 60),
  reason     text check (reason is null or char_length(reason) <= 140),
  kind       text not null default 'game' check (kind in ('game', 'feature', 'other')),
  status     text not null default 'open' check (status in ('open', 'planned', 'added', 'declined')),
  hidden     boolean not null default false,
  votes      int not null default 0,
  created_at timestamptz not null default now()
);

-- one vote per device; net is a hash of the network address, never the address itself
create table if not exists public.request_votes (
  device     uuid primary key,
  request_id bigint not null references public.requests on delete cascade,
  net        text,
  created_at timestamptz not null default now()
);
create index if not exists request_votes_net_idx on public.request_votes (net, created_at);

create table if not exists public.online_now (
  device  uuid primary key,
  seen_at timestamptz not null default now()
);

alter table public.requests      enable row level security;
alter table public.request_votes enable row level security;   -- no policies: functions only
alter table public.online_now    enable row level security;   -- no policies: functions only

drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests for select to anon, authenticated using (not hidden);

-- the caller's network, hashed (Supabase passes the address in x-forwarded-for)
create or replace function public.caller_net()
returns text language sql stable set search_path = public, extensions as $$
  select encode(digest(coalesce(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''), 'sha256'), 'hex');
$$;

-- The option this device voted for (a table, so the page reads it like the private one).
create or replace function public.my_votes(p_device uuid)
returns table (request_id bigint) language sql stable security definer set search_path = public, extensions as $$
  select request_id from request_votes where device = p_device;
$$;

-- One vote per device: picking an option moves the vote there, and picking the
-- same one again takes it back. Returns null when it worked, or a short reason.
-- shortcut: a new device id is just a cleared browser, so one network may add at
-- most 300 new voting devices a day (a whole school shares one address); add
-- Turnstile if the poll gets stuffed.
create or replace function public.vote_for(p_request bigint, p_device uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare had bigint; v_net text := caller_net();
begin
  if p_device is null then return 'Something went wrong. Reload and try again.'; end if;
  if not exists (select 1 from requests where id = p_request and not hidden and status in ('open', 'planned')) then
    return 'That option isn''t open for votes.';
  end if;
  select request_id into had from request_votes where device = p_device;
  if had is null and (select count(*) from request_votes where net = v_net and created_at > now() - interval '1 day') >= 300 then
    return 'Too many new votes from this network today. Try again tomorrow.';
  end if;

  delete from request_votes where device = p_device;
  if had is distinct from p_request then
    insert into request_votes (device, request_id, net) values (p_device, p_request, v_net);
  end if;
  update requests r set votes = (select count(*) from request_votes v where v.request_id = r.id)
   where r.id in (p_request, had);
  return null;
end; $$;

-- People online: each open Notebook checks in every 30 seconds.
create or replace function public.i_am_here(p_device uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_device is null then return; end if;
  insert into online_now (device, seen_at) values (p_device, now())
  on conflict (device) do update set seen_at = now();
  delete from online_now where seen_at < now() - interval '1 hour';
end; $$;

create or replace function public.online_count()
returns int language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int from online_now where seen_at > now() - interval '90 seconds';
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_votes(uuid), public.vote_for(bigint, uuid),
  public.i_am_here(uuid), public.online_count() to anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
revoke all on public.request_votes, public.online_now from anon, authenticated;
grant select on public.requests to anon, authenticated;

-- new options and vote counts show up live on the page
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'requests') then
    alter publication supabase_realtime add table public.requests;
  end if;
end $$;

-- the first options, copied from the private poll (round 4); only when the table is empty
insert into public.requests (title, reason, kind, status)
select * from (values
  ('Two-player games', 'Games you and a friend can play side by side on one keyboard.', 'game', 'open'),
  ('Game of the week', 'One game gets the spotlight on Home every week.', 'feature', 'open'),
  ('Achievements', 'Earn badges for playing games.', 'feature', 'open'),
  ('More wallpapers', 'A bigger set of wallpapers to pick from in the OS look.', 'feature', 'open'),
  ('Lesson folders', 'Make your own folders of games to keep favorites organized.', 'feature', 'open'),
  ('Cookie Clicker', 'Click the cookie, buy grandmas, never stop.', 'game', 'added'),
  ('Favorite games', 'Star the games you play most so they stay at the top.', 'feature', 'added'),
  ('New looks', 'Basic (Night or Mono) and Space themes.', 'feature', 'added'),
  ('Chalk Music', 'Your songs and playlists in their own tab.', 'feature', 'added'),
  ('OS look', 'A sidebar desktop over a wallpaper you pick.', 'feature', 'added')
) as v(title, reason, kind, status)
where not exists (select 1 from public.requests);


-- ================================================================ Class chat
-- The public chat (class-chat.html). Stricter than the private one:
--   Global   everyone is in it, only site mods post (announcements).
--   friends  a direct message needs an accepted friend request.
--   classes  no class list and no join codes: the people who run a class
--            invite their friends, and only invited people get in.
--   auto mod a bigger blocked-words list that sees through l33t, repeated and
--            spaced-out letters; messages it catches are never posted, and
--            their text only shows to a mod who opens the report. Links only
--            in channels that allow them. Slower sending, a daily cap on
--            friend requests, and timeouts that get longer each time.
--
-- Site mods: there is no mod password. Only the owner makes someone a mod,
-- by their username, here in the SQL editor:
--   update public.profiles set is_mod = true  where username = 'their_name';
--   update public.profiles set is_mod = false where username = 'their_name';   -- undo
-- Dashboard: Authentication > Sign In / Providers > Email: turn OFF "Confirm
-- email" (accounts use made-up addresses).
-- Every rule lives in the database, so editing the page gets nobody anywhere.

create extension if not exists citext with schema extensions;
create extension if not exists unaccent with schema extensions;

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    extensions.citext unique not null,
  is_mod      boolean not null default false,
  banned      boolean not null default false,
  created_at  timestamptz not null default now(),
  muted_until timestamptz,
  timeouts    int not null default 0,          -- auto timeouts so far (each one is longer)
  avatar      text check (avatar is null or avatar ~ '^([0-9]|1[0-9])\.[0-9]$'),
  bio         text check (bio is null or char_length(bio) <= 140),
  banner      text check (banner is null or banner ~ '^[0-7]$')
);

create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  is_private boolean not null default true,    -- the page reads it; only Global is not private
  is_global  boolean not null default false,
  owner_id   uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id   uuid references public.rooms on delete cascade,
  user_id   uuid references public.profiles on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'mod', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_invites (
  room_id    uuid not null references public.rooms on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  invited_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  category    text not null default 'General' check (char_length(category) between 1 and 24),
  allow_links boolean not null default false,
  created_by  uuid references public.profiles on delete set null,
  created_at  timestamptz not null default now(),
  unique (room_id, name)
);

create table if not exists public.messages (
  id         bigserial primary key,
  channel_id uuid not null references public.channels on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  reply_to   bigint,
  created_at timestamptz not null default now()
);
-- named like the private one, so the page's reply lookup works unchanged
alter table public.messages drop constraint if exists messages_reply_to_fkey;
alter table public.messages add constraint messages_reply_to_fkey
  foreign key (reply_to) references public.messages (id) on delete set null;

-- friend requests sent (kind 'friend'), for the daily cap
create table if not exists public.secret_attempts (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);

-- mode: w = the whole word, s = the start of a word ("shoot" catches "shooting"),
-- a = anywhere once spaces and dots are taken out ("f.u.c.k", "f u c k")
create table if not exists public.blocked_words (
  word text primary key check (char_length(word) between 2 and 40),
  mode text not null default 'w' check (mode in ('w', 's', 'a'))
);

create table if not exists public.automod_strikes (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles on delete cascade,
  reason     text not null,
  created_at timestamptz not null default now()
);

-- Reports carry no message text: that sits in report_bodies, which nobody can
-- read except through report_body(), so a mod's screen never loads it until
-- they click "Show message".
create table if not exists public.reports (
  id            bigserial primary key,
  kind          text not null default 'user' check (kind in ('user', 'automod', 'dm')),
  message_id    bigint references public.messages on delete set null,
  msg_ref       bigint,
  room_id       uuid references public.rooms on delete cascade,
  channel_id    uuid references public.channels on delete set null,
  reported_user uuid references public.profiles on delete cascade,
  reporter_id   uuid references public.profiles on delete set null,
  reason        text,
  status        text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  auto_removed  boolean not null default false,
  resolved_by   uuid references public.profiles on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (msg_ref, reporter_id)
);
create table if not exists public.report_bodies (
  report_id bigint primary key references public.reports on delete cascade,
  body      text not null
);

create table if not exists public.mentions (
  id         bigserial primary key,
  message_id bigint not null references public.messages on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  by_user    uuid references public.profiles on delete set null,
  room_id    uuid references public.rooms on delete cascade,
  channel_id uuid references public.channels on delete cascade,
  seen       boolean not null default false,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table if not exists public.room_bans (
  room_id    uuid not null references public.rooms on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  banned_by  uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.dm_messages (
  id           bigserial primary key,
  sender_id    uuid not null references public.profiles on delete cascade,
  recipient_id uuid not null references public.profiles on delete cascade,
  body         text not null check (char_length(body) between 1 and 500),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);

create table if not exists public.dm_blocks (
  blocker_id uuid not null references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.friendships (
  requester  uuid not null references public.profiles on delete cascade,
  addressee  uuid not null references public.profiles on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

-- who has the chat open (online_now above counts Notebook devices instead)
create table if not exists public.chat_online (
  user_id uuid primary key references public.profiles on delete cascade,
  seen_at timestamptz not null default now()
);

create index if not exists messages_channel_idx on public.messages (channel_id, id);
create index if not exists messages_user_idx on public.messages (user_id, created_at);
create index if not exists messages_reply_idx on public.messages (reply_to);
create index if not exists channels_room_idx on public.channels (room_id);
create index if not exists secret_attempts_idx on public.secret_attempts (user_id, kind, created_at);
create index if not exists strikes_user_idx on public.automod_strikes (user_id, created_at);
create index if not exists reports_open_idx on public.reports (status, created_at);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at);
create index if not exists mentions_user_idx on public.mentions (user_id, seen, created_at desc);
create index if not exists invites_user_idx on public.room_invites (user_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee, status);
create index if not exists dm_pair_idx on public.dm_messages (sender_id, recipient_id, created_at);
create index if not exists dm_pair_rev_idx on public.dm_messages (recipient_id, sender_id, created_at);

-- ---------------------------------------------------------------- the word list
-- Kept encoded here so this file (and the site) never spells the words out.
-- Add more in Table Editor > blocked_words; rerunning keeps yours.
insert into public.blocked_words (word, mode)
select split_part(x, ':', 1), split_part(x, ':', 2)
  from unnest(string_to_array(convert_from(decode('YXNzOncsYXNzaG9sZTp3LGFzc2hvbGVzOncsYmFzdGFyZDp3LGJhc3RhcmRzOncsYmVhbmVyOncsYmVhbmVyczp3LGJpdGNoOnMsYmxvd2pvYjp3LGJvb2I6cyxidWxsc2hpdDp3LGJ5cGFzczphLGNoaW5rOncsY2hpbmtzOncsY29jazp3LGNvY2tzOncsY29vbjp3LGNvb25zOncsY3VtOncsY3VudDpzLGRpY2s6dyxkaWNraGVhZDp3LGRpY2tzOncsZGlsZG86cyxkaXNjb3JkOmEsZHlrZTp3LGR5a2VzOncsZmFnOncsZmFnZ290OmEsZmFnczp3LGZjazp3LGZ1Yzp3LGZ1Y2s6YSxmdWs6dyxnbyBkaWU6dyxnb29rOncsZ29va3M6dyxndGZvOncsaGFuZGpvYjp3LGhhbmcgeW91cnNlbGY6dyxoZWlsIGhpdGxlcjp3LGhlbnRhaTphLGhvZTp3LGhvZXM6dyxob3JueTpzLGppeno6cyxraWtlOncsa2lrZXM6dyxraWxsIHVyIHNlbGY6dyxraWxsIHVyc2VsZjp3LGtpbGwgeW91cnNlbGY6dyxrbXM6dyxreXM6dyxtaWxmOncsbW9sZXN0OnMsbmVjayB5b3Vyc2VsZjp3LG5pZ2dhOmEsbmlnZ2VyOmEsbnNmdzp3LG51ZGU6cyxvbmx5ZmFuczphLHBlZG86dyxwZWRvcGhpbGU6YSxwZW5pczp3LHBpc3M6dyxwaXNzZWQ6dyxwb3JuOnMscHJpY2s6dyxwdXNzaWVzOnMscHVzc3k6cyxyYWdoZWFkOncscmFwZTp3LHJhcGVkOncscmFwaXN0OnMscmV0YXJkOnMsc2V4OnMsc2hpdDpzLHNob290OnMsc2llZyBoZWlsOncsc2xpdCB5b3VyIHdyaXN0czp3LHNsdXQ6cyxzcGljOncsc3BpY3M6dyxzdGZ1OncsdGhvdDp3LHRpa3RvazphLHRpdHM6dyx0aXR0aWVzOncsdGl0dHk6dyx0b3dlbGhlYWQ6dyx0cmFubmllczp3LHRyYW5ueTp3LHR3YXQ6cyx1bmJsb2NrOnMsdmFnaW5hOncsd2FuazpzLHdldGJhY2s6dyx3ZXRiYWNrczp3LHdob3JlOnMsd3RmOnc=', 'base64'), 'UTF8'), ',')) as x
on conflict (word) do update set mode = excluded.mode;

-- ---------------------------------------------------------------- helpers

create or replace function public.is_site_mod(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select is_mod from profiles where id = uid), false);
$$;

create or replace function public.is_banned(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select banned from profiles where id = uid), false);
$$;

create or replace function public.room_role(p_room uuid, uid uuid default auth.uid())
returns text language sql stable security definer set search_path = public, extensions as $$
  select role from room_members where room_id = p_room and user_id = uid;
$$;

-- members only (everyone is a member of Global), plus site mods
create or replace function public.can_read_room(p_room uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select is_site_mod() or exists (select 1 from room_members where room_id = p_room and user_id = auth.uid());
$$;

create or replace function public.can_manage_room(p_room uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select is_site_mod() or coalesce(room_role(p_room) in ('owner', 'mod'), false);
$$;

create or replace function public.channel_room(p_channel uuid)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select room_id from channels where id = p_channel;
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from friendships where status = 'accepted'
                  and ((requester = a and addressee = b) or (requester = b and addressee = a)));
$$;

-- True if the text has a blocked word. It undoes fancy and wide letters, accents,
-- hidden characters and
-- swaps like 3 for e, and each letter may repeat ("shiiit"). Single letters
-- with gaps between them ("s e x", "s.e.x") are joined first, and 'a' words
-- are also looked for with every non-letter taken out.
create or replace function public.has_blocked_word(p_text text)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
declare t text; j text; sq text;
begin
  t := translate(lower(extensions.unaccent(normalize(coalesce(p_text, ''), NFKC))), '0134578@$!|+', 'oieastbasilt');
  t := regexp_replace(t, '[​-‏⁠﻿­]', '', 'g');
  j := regexp_replace(t, '(?<=\m[a-z])[^a-z0-9]+(?=[a-z]\M)', '', 'g');
  sq := regexp_replace(t, '[^a-z]', '', 'g');
  return exists (
    select 1 from (select mode, regexp_replace(word, '([a-z])', '\1+', 'g') as p from blocked_words) w
     where case w.mode
             when 'a' then sq ~ w.p or t ~ ('\m' || w.p) or j ~ ('\m' || w.p)
             when 's' then t ~ ('\m' || w.p) or j ~ ('\m' || w.p)
             else t ~ ('\m' || w.p || '\M') or j ~ ('\m' || w.p || '\M')
           end);
end; $$;

-- a link or a bare site name ("example.com", "example dot com")
create or replace function public.has_link(p_text text)
returns boolean language sql immutable set search_path = public, extensions as $$
  select lower(coalesce(p_text, '')) ~ '(https?:|www\.|[a-z0-9-]+ ?(\.|\(dot\)|\[dot\]| dot ) ?(com|net|org|io|gg|xyz|me|co|ly|app|dev|tv|us|uk|ru|cc|info|link|site|win|online|to|be|lol|fun|club|top)\M)';
$$;

create or replace function public.record_wrong_guess(p_kind text)
returns void language sql security definer set search_path = public, extensions as $$
  insert into secret_attempts (user_id, kind) values (auth.uid(), p_kind);
  delete from secret_attempts where created_at < now() - interval '1 day';
$$;

create or replace function public.is_new_account(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select created_at > now() - interval '24 hours' from profiles where id = uid), false);
$$;

-- Times someone out, longer each time: 10 minutes, 1 hour, 1 day, then a week
-- (new accounts start at 1 hour), and files an auto mod report. Returns how
-- long, in words. Not callable from the site.
create or replace function public.auto_timeout(uid uuid, why text, p_room uuid default null, p_body text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare n int; rid bigint;
        steps interval[] := array[interval '10 minutes', interval '1 hour', interval '1 day', interval '7 days'];
        names text[] := array['10 minutes', '1 hour', '1 day', '1 week'];
begin
  update profiles set timeouts = timeouts + 1 where id = uid returning timeouts into n;
  if n is null then return null; end if;
  n := least(4, n + case when is_new_account(uid) then 1 else 0 end);
  update profiles set muted_until = now() + steps[n] where id = uid;
  insert into reports (kind, room_id, reported_user, reason)
  values ('automod', p_room, uid, 'Timed out ' || names[n] || '. ' || why)
  returning id into rid;
  if p_body is not null then insert into report_bodies values (rid, p_body); end if;
  return names[n];
end; $$;

-- ---------------------------------------------------------------- new accounts

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare g uuid; v_name text := btrim(coalesce(new.raw_user_meta_data ->> 'username', ''));
begin
  if v_name !~ '^[A-Za-z0-9_.-]{2,20}$' then
    raise exception 'Usernames are 2-20 letters, numbers, _ . or -';
  end if;
  if has_blocked_word(v_name) or has_blocked_word(regexp_replace(v_name, '[_.-]', ' ', 'g'))
     or translate(lower(v_name), '01345', 'oieas') ~ '(admin|moderator|chalk.?bored|staff|official|support)' then
    raise exception 'That username isn''t allowed.';
  end if;
  insert into public.profiles (id, username) values (new.id, v_name);
  select id into g from public.rooms where is_global limit 1;
  if g is not null then
    insert into public.room_members (room_id, user_id, role) values (g, new.id, 'member') on conflict do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- site mods

-- No mod password: mods are set by username in the SQL editor (see the top of
-- this section). These are gone on purpose.
drop function if exists public.claim_mod(text);
drop function if exists public.set_mod_password(text);
drop function if exists public.check_guess_limit(text);
drop table if exists public.app_config;

create or replace function public.set_banned(p_username text, p_banned boolean)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare target uuid;
begin
  if not is_site_mod() then raise exception 'Moderators only.'; end if;
  select id into target from profiles where username = p_username and not is_mod;
  if target is null then raise exception 'No user by that name.'; end if;
  update profiles set banned = p_banned where id = target;
  return true;
end; $$;

create or replace function public.delete_account(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_site_mod() then return 'Only site mods can do that.'; end if;
  if p_user is null or p_user = auth.uid() then return 'Pick someone else.'; end if;
  if is_site_mod(p_user) then return 'You can''t delete a site mod.'; end if;
  delete from auth.users where id = p_user;
  return null;
end; $$;

-- ---------------------------------------------------------------- classes

-- A class of your own (up to 3, not on your first day). Nobody can find or
-- join it: its owner and class mods invite their friends.
create or replace function public.create_room(p_name text, p_private boolean default true, p_password text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if is_banned() then raise exception 'You are banned.'; end if;
  if not is_site_mod() then
    if is_new_account() then raise exception 'New accounts can make a class after their first day.'; end if;
    if (select count(*) from rooms where owner_id = auth.uid()) >= 3 then
      raise exception 'You already run 3 classes.';
    end if;
  end if;
  insert into rooms (name, is_private, owner_id) values (btrim(p_name), true, auth.uid()) returning id into new_id;
  insert into room_members (room_id, user_id, role) values (new_id, auth.uid(), 'owner');
  insert into channels (room_id, name, created_by) values (new_id, 'general', auth.uid());
  return new_id;
end; $$;

-- Invite a friend (owner, class mods, site mods). Returns null or a reason.
create or replace function public.invite_to_room(p_room uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if is_banned() then return 'Your account is banned.'; end if;
  if (select is_global from rooms where id = p_room) is not false then return 'You can''t invite people there.'; end if;
  if not can_manage_room(p_room) then return 'Only the people who run this class can invite.'; end if;
  if not is_site_mod() and not are_friends(auth.uid(), p_user) then return 'You can only invite your friends.'; end if;
  if is_banned(p_user) then return 'That account is banned.'; end if;
  if exists (select 1 from room_bans where room_id = p_room and user_id = p_user) then return 'They are banned from this class.'; end if;
  if exists (select 1 from room_members where room_id = p_room and user_id = p_user) then return 'They are already in this class.'; end if;
  if (select count(*) from room_invites where room_id = p_room) >= 50 then return 'This class has 50 invites waiting.'; end if;
  insert into room_invites (room_id, user_id, invited_by) values (p_room, p_user, auth.uid()) on conflict do nothing;
  return null;
end; $$;

-- Your invites, with the class and who asked.
create or replace function public.my_invites()
returns table (room_id uuid, room_name text, invited_by text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select i.room_id, r.name, p.username::text, i.created_at
    from room_invites i join rooms r on r.id = i.room_id left join profiles p on p.id = i.invited_by
   where i.user_id = auth.uid() order by i.created_at desc;
$$;

create or replace function public.answer_invite(p_room uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  delete from room_invites where room_id = p_room and user_id = auth.uid();
  if not found then return 'That invite is gone.'; end if;
  if p_accept then
    if is_banned() then return 'Your account is banned.'; end if;
    if exists (select 1 from room_bans where room_id = p_room and user_id = auth.uid()) then return 'You are banned from that class.'; end if;
    insert into room_members (room_id, user_id, role) values (p_room, auth.uid(), 'member') on conflict do nothing;
  end if;
  return null;
end; $$;

create or replace function public.set_room_role(p_room uuid, p_username text, p_role text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare target uuid;
begin
  if not (is_site_mod() or room_role(p_room) = 'owner') then raise exception 'Only the class owner can do that.'; end if;
  if p_role not in ('mod', 'member') then raise exception 'Unknown role.'; end if;
  select id into target from profiles where username = p_username;
  if target is null or room_role(p_room, target) is null then raise exception 'They aren''t in this class.'; end if;
  if room_role(p_room, target) = 'owner' then raise exception 'That''s the owner.'; end if;
  update room_members set role = p_role where room_id = p_room and user_id = target;
  return true;
end; $$;

-- Banning someone from a class also takes them out of it.
create or replace function public.set_room_banned(p_room uuid, p_user uuid, p_banned boolean)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if p_room is null or p_user is null then return 'Pick a person first.'; end if;
  if not can_manage_room(p_room) then return 'Only the people who run this class can do that.'; end if;
  if is_site_mod(p_user) then return 'You can''t ban a site mod.'; end if;
  if room_role(p_room, p_user) in ('owner', 'mod') and not is_site_mod() then return 'You can''t ban the people who run this class.'; end if;
  if p_banned then
    insert into room_bans (room_id, user_id, banned_by) values (p_room, p_user, auth.uid()) on conflict do nothing;
    delete from room_members where room_id = p_room and user_id = p_user and role <> 'owner';
    delete from room_invites where room_id = p_room and user_id = p_user;
  else
    delete from room_bans where room_id = p_room and user_id = p_user;
  end if;
  return null;
end; $$;

-- Owners, class mods and site mods turn links on or off for one channel.
create or replace function public.set_channel_links(p_channel uuid, p_allow boolean)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if not can_manage_room(channel_room(p_channel)) then return 'Only the people who run this class can do that.'; end if;
  update channels set allow_links = coalesce(p_allow, false) where id = p_channel;
  return null;
end; $$;

create or replace function public.check_name()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_site_mod() and (has_blocked_word(new.name) or has_blocked_word(regexp_replace(new.name, '[_.-]', ' ', 'g'))
                            or has_blocked_word(to_jsonb(new) ->> 'category') or has_link(new.name)) then
    raise exception 'That name isn''t allowed.';
  end if;
  return new;
end; $$;

drop trigger if exists rooms_check_name on public.rooms;
create trigger rooms_check_name before insert or update of name on public.rooms
  for each row execute function public.check_name();
drop trigger if exists channels_check_name on public.channels;
create trigger channels_check_name before insert or update of name, category on public.channels
  for each row execute function public.check_name();

-- ---------------------------------------------------------------- sending

-- What auto mod says about a message, or null if it can go out. Strikes and
-- timeouts happen here too. Site mods skip it (except the timeout itself).
create or replace function public.check_post(me profiles, v_body text, p_room uuid, p_links boolean, p_kind text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare why text; long text; strikes int; last_body text;
        gap interval := case when is_new_account(me.id) then interval '5 seconds' else interval '2 seconds' end;
begin
  if me.muted_until is not null and me.muted_until > now() then
    return 'You''re timed out for ' || case when me.muted_until - now() > interval '2 hours'
      then ceil(extract(epoch from me.muted_until - now()) / 3600)::int || ' more hours.'
      else greatest(1, ceil(extract(epoch from me.muted_until - now()) / 60))::int || ' more min.' end;
  end if;
  if me.is_mod then return null; end if;

  -- waits, not strikes: one message every 2 seconds (5 on your first day)
  if exists (select 1 from messages where user_id = me.id and created_at > now() - gap)
     or exists (select 1 from dm_messages where sender_id = me.id and created_at > now() - gap) then
    return 'Slow down a little.';
  end if;
  if not p_links and has_link(v_body) then
    return case when p_kind = 'dm' then 'Links can''t be sent in direct messages.' else 'Links aren''t allowed in this channel.' end;
  end if;

  if (select count(*) from messages where user_id = me.id and created_at > now() - interval '15 seconds')
   + (select count(*) from dm_messages where sender_id = me.id and created_at > now() - interval '15 seconds') >= 5 then
    why := 'Too many messages at once.';
  elsif v_body ~ '(.)\1{9,}' or (char_length(regexp_replace(v_body, '\s', '', 'g')) > 40
        and v_body !~ '[a-z]' and v_body ~ '[A-Z]') then
    why := 'That looks like spam.';
  elsif has_blocked_word(v_body) then
    why := 'That message has a blocked word.';
  end if;
  if why is null and p_kind = 'room' then
    select body into last_body from messages where user_id = me.id and created_at > now() - interval '60 seconds' order by id desc limit 1;
    if lower(last_body) = lower(v_body) then why := 'You just sent that.'; end if;
  end if;
  if why is null then return null; end if;

  insert into automod_strikes (user_id, reason) values (me.id, why);
  select count(*) into strikes from automod_strikes where user_id = me.id and created_at > now() - interval '15 minutes';
  if strikes >= 3 then
    delete from automod_strikes where user_id = me.id;
    long := auto_timeout(me.id, '3 auto mod blocks. Last: ' || why, p_room, v_body);
    return why || ' That''s 3, so you''re timed out for ' || long || '.';
  end if;
  return why;
end; $$;

drop function if exists public.send_message(uuid, text);
create or replace function public.send_message(p_channel uuid, p_body text, p_reply_to bigint default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare me profiles; ch channels; v_body text := btrim(coalesce(p_body, '')); why text; glob boolean;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.banned then return 'Your account is banned.'; end if;
  select * into ch from channels where id = p_channel;
  if ch.id is null then return 'That channel is gone.'; end if;
  select is_global into glob from rooms where id = ch.room_id;
  if glob and not me.is_mod then return 'Only mods post in Global. Add friends to talk with them.'; end if;
  if not me.is_mod and not exists (select 1 from room_members where room_id = ch.room_id and user_id = me.id) then
    return 'You aren''t in this class.';
  end if;
  if char_length(v_body) = 0 then return null; end if;
  if char_length(v_body) > 500 then return 'Messages max out at 500 characters.'; end if;

  why := check_post(me, v_body, ch.room_id, ch.allow_links or can_manage_room(ch.room_id), 'room');
  if why is not null then return why; end if;

  if p_reply_to is not null and not exists (select 1 from messages where id = p_reply_to and channel_id = p_channel) then
    p_reply_to := null;
  end if;
  insert into messages (channel_id, user_id, body, reply_to) values (p_channel, me.id, v_body, p_reply_to);
  return null;
end; $$;

-- Direct messages: friends only, never links, and the same auto mod.
create or replace function public.send_dm(p_to uuid, p_body text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare me profiles; v_body text := btrim(coalesce(p_body, '')); why text;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.banned then return 'Your account is banned.'; end if;
  if p_to is null or p_to = me.id then return 'Pick someone else.'; end if;
  if is_banned(p_to) then return 'That account is banned.'; end if;
  if exists (select 1 from dm_blocks where (blocker_id = me.id and blocked_id = p_to) or (blocker_id = p_to and blocked_id = me.id)) then
    return 'You can''t message this person.';
  end if;
  if not me.is_mod and not are_friends(me.id, p_to) then
    return 'You can only message friends. Send them a friend request first.';
  end if;
  if char_length(v_body) = 0 then return 'Write something first.'; end if;
  if char_length(v_body) > 500 then return 'Messages max out at 500 characters.'; end if;
  why := check_post(me, v_body, null, me.is_mod, 'dm');
  if why is not null then return why; end if;
  insert into dm_messages (sender_id, recipient_id, body) values (me.id, p_to, v_body);
  return null;
end; $$;

create or replace function public.mark_dms_read(p_from uuid default null)
returns void language sql security definer set search_path = public, extensions as $$
  update dm_messages set read_at = now()
   where recipient_id = auth.uid() and read_at is null and (p_from is null or sender_id = p_from);
$$;

create or replace function public.set_dm_blocked(p_user uuid, p_blocked boolean)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if p_user is null or p_user = auth.uid() then return 'Pick someone else.'; end if;
  if p_blocked then
    insert into dm_blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;
    delete from friendships where (requester = auth.uid() and addressee = p_user) or (requester = p_user and addressee = auth.uid());
  else
    delete from dm_blocks where blocker_id = auth.uid() and blocked_id = p_user;
  end if;
  return null;
end; $$;

create or replace function public.save_profile(p_avatar text, p_bio text, p_banner text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_avatar text := nullif(btrim(coalesce(p_avatar, '')), ''); v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
        v_banner text := nullif(btrim(coalesce(p_banner, '')), '');
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if is_banned() then return 'Your account is banned.'; end if;
  if v_avatar is not null and v_avatar !~ '^([0-9]|1[0-9])\.[0-9]$' then return 'Pick one of the pictures.'; end if;
  if v_banner is not null and v_banner !~ '^[0-7]$' then return 'Pick one of the banners.'; end if;
  if v_bio is not null and char_length(v_bio) > 140 then return 'Keep your about line under 140 characters.'; end if;
  if v_bio is not null and (has_blocked_word(v_bio) or has_link(v_bio)) then return 'That about line isn''t allowed.'; end if;
  update profiles set avatar = v_avatar, bio = v_bio, banner = coalesce(v_banner, banner) where id = auth.uid();
  return null;
end; $$;

-- ---------------------------------------------------------------- reports

-- Anyone can report a message once (10 an hour). Three people reporting one
-- message removes it and times its sender out.
create or replace function public.report_message(p_message bigint, p_reason text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare m messages; room uuid; n int; rid bigint;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if is_banned() then return 'Your account is banned.'; end if;
  select * into m from messages where id = p_message;
  if m.id is null then return 'That message is already gone.'; end if;
  room := channel_room(m.channel_id);
  if not can_read_room(room) then return 'You can''t see that message.'; end if;
  if m.user_id = auth.uid() then return 'You can''t report yourself.'; end if;
  if (select count(*) from reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    return 'You''ve sent a lot of reports. Try again later.';
  end if;

  insert into reports (message_id, msg_ref, room_id, channel_id, reported_user, reporter_id, reason)
  values (m.id, m.id, room, m.channel_id, m.user_id, auth.uid(), left(nullif(btrim(coalesce(p_reason, '')), ''), 200))
  on conflict (msg_ref, reporter_id) do nothing returning id into rid;
  if rid is null then return 'You already reported that.'; end if;
  insert into report_bodies values (rid, m.body);

  select count(distinct reporter_id) into n from reports where msg_ref = m.id and status = 'open';
  if n >= 3 and not is_site_mod(m.user_id) then
    update reports set auto_removed = true where msg_ref = m.id;
    delete from messages where id = m.id;
    perform auto_timeout(m.user_id, 'A message got 3 reports.', room);
    return 'Reported. That was the third report, so it''s been removed.';
  end if;
  return 'Reported. A moderator will take a look.';
end; $$;

create or replace function public.report_dm(p_dm bigint, p_reason text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare d dm_messages; rid bigint;
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  select * into d from dm_messages where id = p_dm;
  if d.id is null or d.recipient_id <> auth.uid() then return 'You can only report messages sent to you.'; end if;
  insert into reports (kind, msg_ref, reported_user, reporter_id, reason)
  values ('dm', -d.id, d.sender_id, auth.uid(), left(nullif(btrim(coalesce(p_reason, '')), ''), 200))
  on conflict (msg_ref, reporter_id) do nothing returning id into rid;
  if rid is null then return 'You already reported that.'; end if;
  insert into report_bodies values (rid, d.body);
  return 'Reported. A site moderator will take a look.';
end; $$;

-- The reported text, only when a mod clicks to see it.
create or replace function public.report_body(p_report bigint)
returns text language sql stable security definer set search_path = public, extensions as $$
  select b.body from reports r join report_bodies b on b.report_id = r.id
   where r.id = p_report and (is_site_mod() or (r.room_id is not null and can_manage_room(r.room_id)));
$$;

-- p_action: 'dismiss' | 'remove' | 'timeout' (the next, longer step; site mods) | 'ban' (site mods)
create or replace function public.resolve_report(p_report bigint, p_action text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare r reports;
begin
  select * into r from reports where id = p_report;
  if r.id is null then return 'No such report.'; end if;
  if not (is_site_mod() or (r.room_id is not null and can_manage_room(r.room_id))) then return 'You can''t act on this report.'; end if;
  if p_action in ('timeout', 'ban') and not is_site_mod() then return 'Only site mods can time out or ban.'; end if;
  if p_action not in ('dismiss', 'remove', 'timeout', 'ban') then return 'Unknown action.'; end if;
  -- close first, so the report a timeout files stays open
  update reports set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
                     resolved_by = auth.uid(), resolved_at = now()
   where status = 'open' and (id = r.id or (r.msg_ref is not null and msg_ref = r.msg_ref));
  if p_action <> 'dismiss' and r.message_id is not null then delete from messages where id = r.message_id; end if;
  if p_action = 'timeout' then perform auto_timeout(r.reported_user, 'By a mod, from a report.', r.room_id); end if;
  if p_action = 'ban' then update profiles set banned = true where id = r.reported_user and not is_mod; end if;
  return null;
end; $$;

-- ---------------------------------------------------------------- @mentions

create or replace function public.make_mentions()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_room uuid := channel_room(new.channel_id); v_handle text; v_target uuid; v_count int := 0;
begin
  for v_handle in
    select distinct lower(rtrim(m[1], '.-')) from regexp_matches(new.body, '(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_.-]{2,20})', 'g') as m
  loop
    exit when v_count >= 5;
    select id into v_target from profiles where lower(username::text) = v_handle;
    continue when v_target is null or v_target = new.user_id;
    continue when not exists (select 1 from room_members where room_id = v_room and user_id = v_target);
    insert into mentions (message_id, user_id, by_user, room_id, channel_id)
    values (new.id, v_target, new.user_id, v_room, new.channel_id) on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return new;
end; $$;

drop trigger if exists messages_mentions on public.messages;
create trigger messages_mentions after insert on public.messages
  for each row execute function public.make_mentions();

create or replace function public.mark_mentions_seen(p_ids bigint[] default null)
returns void language sql security definer set search_path = public, extensions as $$
  update mentions set seen = true where user_id = auth.uid() and not seen and (p_ids is null or id = any(p_ids));
$$;

-- ---------------------------------------------------------------- friends

create or replace function public.friend_map()
returns table(user_id uuid, state text) language sql stable security definer set search_path = public, extensions as $$
  select case when requester = auth.uid() then addressee else requester end,
         case when status = 'accepted' then 'friend' when requester = auth.uid() then 'out' else 'in' end
    from friendships where requester = auth.uid() or addressee = auth.uid();
$$;

-- At most 10 friend requests a day and 20 waiting at once.
create or replace function public.ask_friend(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if p_user is null or p_user = auth.uid() then return 'Pick someone else.'; end if;
  if is_banned() then return 'Your account is banned.'; end if;
  if not exists (select 1 from profiles where id = p_user and not banned) then return 'No such person.'; end if;
  if exists (select 1 from dm_blocks where (blocker_id = auth.uid() and blocked_id = p_user) or (blocker_id = p_user and blocked_id = auth.uid())) then
    return 'You can''t add this person.';
  end if;
  if are_friends(auth.uid(), p_user) then return 'You are already friends.'; end if;
  if exists (select 1 from friendships where requester = p_user and addressee = auth.uid()) then
    update friendships set status = 'accepted' where requester = p_user and addressee = auth.uid();
    return null;
  end if;
  if exists (select 1 from friendships where requester = auth.uid() and addressee = p_user) then return null; end if;
  if not is_site_mod() then
    if (select count(*) from secret_attempts where user_id = auth.uid() and kind = 'friend' and created_at > now() - interval '1 day') >= 10 then
      return 'That''s 10 friend requests today. Try again tomorrow.';
    end if;
    if (select count(*) from friendships where requester = auth.uid() and status = 'pending') >= 20 then
      return 'You have 20 requests waiting. Wait for some answers first.';
    end if;
  end if;
  insert into friendships (requester, addressee) values (auth.uid(), p_user);
  perform record_wrong_guess('friend');   -- counts requests for the daily cap
  return null;
end; $$;

create or replace function public.answer_friend(p_user uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return 'Sign in first.'; end if;
  if not exists (select 1 from friendships where requester = p_user and addressee = auth.uid() and status = 'pending') then
    return 'That request is gone.';
  end if;
  if p_accept then update friendships set status = 'accepted' where requester = p_user and addressee = auth.uid();
  else delete from friendships where requester = p_user and addressee = auth.uid(); end if;
  return null;
end; $$;

create or replace function public.drop_friend(p_user uuid)
returns text language sql security definer set search_path = public, extensions as $$
  delete from friendships where (requester = auth.uid() and addressee = p_user) or (requester = p_user and addressee = auth.uid());
  select null::text;
$$;

create or replace function public.mutual_friends(p_user uuid)
returns table(user_id uuid, username text, avatar text) language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.username::text, p.avatar from profiles p
   where are_friends(p.id, auth.uid()) and are_friends(p.id, p_user) and p.id <> auth.uid()
   order by p.username limit 50;
$$;

create or replace function public.shared_rooms(p_user uuid)
returns table(id uuid, name text) language sql stable security definer set search_path = public, extensions as $$
  select r.id, r.name from rooms r
   where exists (select 1 from room_members a where a.room_id = r.id and a.user_id = auth.uid())
     and exists (select 1 from room_members b where b.room_id = r.id and b.user_id = p_user)
   order by r.is_global desc, r.name limit 50;
$$;

-- ---------------------------------------------------------------- who's online in the chat

create or replace function public.chat_here()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null or is_banned() then return; end if;
  insert into chat_online (user_id, seen_at) values (auth.uid(), now()) on conflict (user_id) do update set seen_at = now();
  delete from chat_online where seen_at < now() - interval '1 day';
end; $$;

create or replace function public.online_ids()
returns uuid[] language sql stable security definer set search_path = public, extensions as $$
  select coalesce(array_agg(user_id), '{}') from chat_online where seen_at > now() - interval '90 seconds';
$$;

create or replace function public.online_in_room(p_room uuid)
returns int language sql stable security definer set search_path = public, extensions as $$
  select case when can_read_room(p_room) then
    (select count(*)::int from chat_online o join room_members m on m.user_id = o.user_id
      where m.room_id = p_room and o.seen_at > now() - interval '90 seconds') else 0 end;
$$;

-- ---------------------------------------------------------------- row rules

do $$
declare t text;
begin
  foreach t in array array['profiles', 'rooms', 'room_members', 'room_invites', 'channels', 'messages',
    'secret_attempts', 'blocked_words', 'automod_strikes', 'reports', 'report_bodies', 'mentions', 'room_bans',
    'dm_messages', 'dm_blocks', 'friendships', 'chat_online'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- No policies (functions only): secret_attempts, blocked_words,
-- automod_strikes, report_bodies, chat_online.

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

-- you see the classes you're in or invited to; site mods see all
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated
  using (can_read_room(id) or exists (select 1 from room_invites i where i.room_id = id and i.user_id = auth.uid()));
drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms for delete to authenticated
  using ((is_site_mod() or owner_id = auth.uid()) and not is_global);

drop policy if exists members_read on public.room_members;
create policy members_read on public.room_members for select to authenticated using (can_read_room(room_id));
-- leave a class (not Global), or take someone out of one you run
drop policy if exists members_leave on public.room_members;
create policy members_leave on public.room_members for delete to authenticated
  using (not coalesce((select is_global from rooms r where r.id = room_id), false)
         and (user_id = auth.uid() or can_manage_room(room_id)));

drop policy if exists invites_read on public.room_invites;
create policy invites_read on public.room_invites for select to authenticated
  using (user_id = auth.uid() or can_manage_room(room_id));
drop policy if exists invites_cancel on public.room_invites;
create policy invites_cancel on public.room_invites for delete to authenticated
  using (user_id = auth.uid() or can_manage_room(room_id));

drop policy if exists channels_read on public.channels;
create policy channels_read on public.channels for select to authenticated using (can_read_room(room_id));
drop policy if exists channels_create on public.channels;
create policy channels_create on public.channels for insert to authenticated
  with check (not is_banned() and created_by = auth.uid() and not allow_links and
              case when (select is_global from rooms r where r.id = room_id) then is_site_mod() else can_manage_room(room_id) end);
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated using (can_manage_room(room_id));

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (can_read_room(channel_room(channel_id)));
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated
  using (user_id = auth.uid() or can_manage_room(channel_room(channel_id)));

drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated
  using (is_site_mod() or (room_id is not null and can_manage_room(room_id)));

drop policy if exists mentions_mine on public.mentions;
create policy mentions_mine on public.mentions for select to authenticated using (user_id = auth.uid());

drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

drop policy if exists room_bans_read on public.room_bans;
create policy room_bans_read on public.room_bans for select to authenticated using (can_manage_room(room_id));

drop policy if exists dm_read on public.dm_messages;
create policy dm_read on public.dm_messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists dm_blocks_mine on public.dm_blocks;
create policy dm_blocks_mine on public.dm_blocks for select to authenticated using (blocker_id = auth.uid());

-- ---------------------------------------------------------------- who can run what
-- Functions made since the Requests part's revoke start out callable, so lock
-- every one again and hand back exactly what the pages use.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_votes(uuid), public.vote_for(bigint, uuid),
  public.i_am_here(uuid), public.online_count() to anon, authenticated;

revoke all on public.secret_attempts, public.blocked_words, public.automod_strikes,
  public.report_bodies, public.chat_online from anon, authenticated;
revoke all on public.profiles, public.rooms, public.room_members, public.room_invites, public.channels,
  public.messages, public.reports, public.mentions, public.room_bans, public.dm_messages, public.dm_blocks,
  public.friendships from anon;
-- signed in: read through the row rules above, and only these direct writes
revoke insert, update, delete, truncate on public.profiles, public.rooms, public.room_members, public.room_invites,
  public.channels, public.messages, public.reports, public.mentions, public.room_bans, public.dm_messages,
  public.dm_blocks, public.friendships from authenticated;
grant select on public.profiles, public.rooms, public.room_members, public.room_invites, public.channels,
  public.messages, public.reports, public.mentions, public.room_bans, public.dm_messages, public.dm_blocks,
  public.friendships to authenticated;
grant delete on public.rooms, public.room_members, public.room_invites, public.channels, public.messages to authenticated;
grant insert on public.channels to authenticated;

grant execute on function
  public.can_manage_room(uuid), public.can_read_room(uuid), public.channel_room(uuid),
  public.is_banned(uuid), public.is_site_mod(uuid),
  public.create_room(text, boolean, text), public.invite_to_room(uuid, uuid), public.my_invites(),
  public.answer_invite(uuid, boolean), public.set_room_role(uuid, text, text), public.set_room_banned(uuid, uuid, boolean),
  public.set_channel_links(uuid, boolean), public.send_message(uuid, text, bigint), public.send_dm(uuid, text),
  public.mark_dms_read(uuid), public.set_dm_blocked(uuid, boolean), public.save_profile(text, text, text),
  public.report_message(bigint, text), public.report_dm(bigint, text), public.report_body(bigint),
  public.resolve_report(bigint, text), public.mark_mentions_seen(bigint[]), public.set_banned(text, boolean),
  public.delete_account(uuid), public.friend_map(), public.ask_friend(uuid), public.answer_friend(uuid, boolean),
  public.drop_friend(uuid), public.mutual_friends(uuid), public.shared_rooms(uuid),
  public.chat_here(), public.online_ids(), public.online_in_room(uuid)
to authenticated;

do $$
declare t text;
begin
  foreach t in array array['messages', 'channels', 'rooms', 'reports', 'mentions', 'dm_messages', 'room_invites'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- the Global room

insert into public.rooms (name, is_private, is_global)
select 'Global', false, true where not exists (select 1 from public.rooms where is_global);
insert into public.channels (room_id, name)
select r.id, 'announcements' from public.rooms r
 where r.is_global and not exists (select 1 from public.channels c where c.room_id = r.id);
insert into public.room_members (room_id, user_id, role)
select r.id, p.id, 'member' from public.rooms r, public.profiles p where r.is_global on conflict do nothing;

-- ---------------------------------------------------------------- self-check
-- Stops the run (nothing is saved) if auto mod misses a trick or flags normal words.
do $$
begin
  assert has_blocked_word('sh00ting stars'), 'leet + start of a word';
  assert has_blocked_word('s e x'), 'spaced letters';
  assert has_blocked_word('f.u.c.k this'), 'dotted letters';
  assert has_blocked_word('fuuuuck'), 'repeated letters';
  assert has_blocked_word('ⓢⓗⓘⓣ'), 'fancy letters';
  assert has_blocked_word('unbl0cked games'), 'unblock';
  assert not has_blocked_word('I passed my class assignment, it was a classic'), 'normal words 1';
  assert not has_blocked_word('Sunblock, a photo shot, Scunthorpe and Essex'), 'normal words 2';
  assert has_link('go to example.com now') and has_link('https://x.y') and has_link('example dot com'), 'links';
  assert not has_link('see you at 3.30, ok?'), 'not a link';
end $$;
