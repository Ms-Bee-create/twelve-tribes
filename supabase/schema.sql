-- Syndicate multiplayer schema.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- What this creates:
--   players      one row per player: just enough public info for the shared
--                map + raid resolution (position, power, troop counts). Your
--                actual economy (coins, resources, room levels) stays local
--                on your own phone, exactly like today — the server never
--                needs it.
--   city_control a single shared row: who currently holds the Governor's
--                Office.
--   raid_log     history of raids, so a defender can see what happened while
--                they were away.
--
-- Security model: every signed-in player can READ all of these tables (so
-- the shared map and raid history work), but can only WRITE their own
-- players row. The only way troops/coins ever move between two different
-- players is through the resolve-raid / seize-governor server functions,
-- which run with a privileged key that never reaches anyone's browser and
-- therefore isn't bound by these read/write rules. That's the actual
-- security boundary — not "trusting" any player's phone.

create table players (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  x double precision not null,
  y double precision not null,
  power integer not null default 0,
  hero_levels jsonb not null default '[]'::jsonb,
  troops jsonb not null default '{"enforcer":{"active":0,"wounded":0},"gunner":{"active":0,"wounded":0},"driver":{"active":0,"wounded":0}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table players enable row level security;

create policy "players are readable by any signed-in player"
  on players for select
  to authenticated
  using (true);

create policy "players can only write their own row"
  on players for insert
  to authenticated
  with check (auth.uid() = id);

create policy "players can only update their own row"
  on players for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- one row only, id is always 1 — this is the single shared Governor's Office
create table city_control (
  id integer primary key default 1 check (id = 1),
  held_by uuid references players(id) on delete set null,
  power integer not null default 60,
  cycle_ends_at timestamptz not null default (now() + interval '8 minutes')
);
insert into city_control (id) values (1);

alter table city_control enable row level security;

create policy "city control is readable by any signed-in player"
  on city_control for select
  to authenticated
  using (true);
-- no insert/update policy for regular players on purpose — only the
-- seize-governor server function (service role) is allowed to change this

create table raid_log (
  id bigint generated always as identity primary key,
  attacker_id uuid not null references players(id) on delete cascade,
  defender_id uuid not null references players(id) on delete cascade,
  won boolean not null,
  coin_reward integer not null default 0,
  troops_stolen jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table raid_log enable row level security;

create policy "raid log is readable by the attacker or defender"
  on raid_log for select
  to authenticated
  using (auth.uid() = attacker_id or auth.uid() = defender_id);
-- no insert policy on purpose — only resolve-raid (service role) writes here

-- shared chat — any signed-in player can read all of it, but can only ever
-- insert a row as themselves. Delivered live via Supabase Realtime (see the
-- publication line below) rather than the 25s poll cycle everything else
-- uses, since that cadence would feel bad for a chat.
create table chat_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references players(id) on delete cascade,
  display_name text not null,
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);

alter table chat_messages enable row level security;

create policy "chat is readable by any signed-in player"
  on chat_messages for select
  to authenticated
  using (true);

create policy "players can only send as themselves"
  on chat_messages for insert
  to authenticated
  with check (auth.uid() = sender_id);

alter publication supabase_realtime add table chat_messages;
