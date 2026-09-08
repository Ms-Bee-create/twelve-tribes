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
  mansion_level integer not null default 1,
  hero_levels jsonb not null default '[]'::jsonb,
  -- real hero identity/gear (id/name/level/equippedGear) -- see migration_007
  heroes jsonb not null default '[]'::jsonb,
  -- which of those heroes are currently stationed on the Wall defending home
  wall_garrison jsonb not null default '[]'::jsonb,
  fortification_level integer not null default 0,
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

-- Cheap self-consistency tripwire (2026-09-08, migration_009), NOT real
-- anti-cheat: the above policy lets a signed-in client push any values it
-- wants for its own row, and resolve-raid/seize-governor trust `troops` as
-- real combat input. A full server-authoritative economy would close this
-- properly but is a much bigger rewrite that cuts against this game's whole
-- "economy stays local" design — deliberately not done. Instead: the game's
-- own powerRating() always sums the troop-tierMult term (weight exactly 1)
-- plus several other non-negative contributors, so an HONEST client's
-- pushed `power` can never be less than what its own pushed `troops` alone
-- imply. Rejects a row that fails that (a naive stat edit or broken client
-- math) — does NOT catch troops+power inflated together, an accepted risk.
create or replace function players_validate_profile()
returns trigger
language plpgsql
as $$
declare
  troop_floor numeric := 0;
  tier_mult numeric[] := array[1.0, 2.0, 3.5, 5.0, 7.0]; -- index 1-5, matches TROOP_TYPES' tierMult
  k text;
  v jsonb;
  tier int;
begin
  if new.troops is not null then
    for k, v in select * from jsonb_each(new.troops) loop
      tier := nullif(right(k, 1), '')::int;
      if tier between 1 and 5 then
        troop_floor := troop_floor + coalesce((v->>'active')::numeric, 0) * tier_mult[tier];
      end if;
    end loop;
  end if;
  if new.power < troop_floor - 5 then -- small buffer absorbing the client's own rounding
    raise exception 'players.power (%) is inconsistent with players.troops (implies at least %)', new.power, troop_floor;
  end if;
  return new;
end;
$$;

create trigger players_validate_profile_trigger
  before insert or update on players
  for each row execute function players_validate_profile();

-- one row only, id is always 1 — this is the single shared Governor's Office
create table city_control (
  id integer primary key default 1 check (id = 1),
  held_by uuid references players(id) on delete set null,
  power integer not null default 60,
  cycle_ends_at timestamptz not null default (now() + interval '8 minutes'),
  -- real identity of the garrisoned hero (previously just a bare level
  -- number) -- needed so a wiped garrison's hero can be captured
  garrison_hero_id integer,
  garrison_hero_name text
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
  -- real per-troop-type killed/wounded breakdown for the defender's side,
  -- so their "while you were away" report can be as detailed as the
  -- attacker's own real-time one
  defender_losses jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table raid_log enable row level security;

create policy "raid log is readable by the attacker or defender"
  on raid_log for select
  to authenticated
  using (auth.uid() = attacker_id or auth.uid() = defender_id);
-- no insert policy on purpose — only resolve-raid (service role) writes here

-- One row per captured hero. A hero is never permanently lost: the owner
-- can always eventually get them back (ransom, or once executed/timed out,
-- a cheap local revive) — see pay-ransom and the Prison room.
create table prisoners (
  id bigint generated always as identity primary key,
  hero_id integer not null,
  hero_name text not null,
  hero_level integer not null,
  owner_id uuid not null references players(id) on delete cascade,
  captor_id uuid not null references players(id) on delete cascade,
  captured_at timestamptz not null default now(),
  executed_at timestamptz
);

alter table prisoners enable row level security;

create policy "a player can read prisoners they own or hold"
  on prisoners for select
  to authenticated
  using (auth.uid() = owner_id or auth.uid() = captor_id);

-- No client-side UPDATE policy on purpose (2026-09-08, migration_009): an
-- earlier "captor can execute" policy only checked WHO was asking, not WHICH
-- column changed — RLS can't restrict to one column, so a captor could also
-- rewrite captured_at (defeating the 8-hour guaranteed-revive timeout) or
-- owner_id (orphaning the row from its real owner). Execute now goes through
-- this function instead, which only ever touches executed_at.
create or replace function execute_prisoner(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update prisoners
  set executed_at = now()
  where id = p_id
    and captor_id = auth.uid()
    and executed_at is null;
end;
$$;

grant execute on function execute_prisoner(bigint) to authenticated;

create policy "the owner can clear a resolved prisoner row"
  on prisoners for delete
  to authenticated
  using (auth.uid() = owner_id and (executed_at is not null or captured_at < now() - interval '8 hours'));
-- no insert policy on purpose — only resolve-raid/seize-governor (service role) create captures

-- History of ransoms paid, so a captor can see "while you were away, X paid
-- you a ransom" and credit their own local silver — silver itself never
-- touches the server (see the header comment above), so this is a durable
-- record the captor's own client applies locally, same pattern raid_log
-- already uses for stolen troops.
create table ransom_log (
  id bigint generated always as identity primary key,
  captor_id uuid not null references players(id) on delete cascade,
  owner_id uuid not null references players(id) on delete cascade,
  hero_name text not null,
  silver integer not null,
  created_at timestamptz not null default now()
);

alter table ransom_log enable row level security;

create policy "a captor can read ransoms paid to them"
  on ransom_log for select
  to authenticated
  using (auth.uid() = captor_id);
-- no insert policy on purpose — only pay-ransom (service role) writes here

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
