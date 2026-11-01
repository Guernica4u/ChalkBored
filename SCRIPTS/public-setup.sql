-- ChalkBored PUBLIC: the whole database (Requests poll + people online).
-- Supabase project "ChalkBored Public" (thrwgeuljtqjfcohzfdt), not the private
-- Chalk Chat one. There are no accounts: each browser makes a random id
-- (localStorage "chalk-device") and sends it with each call.
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
