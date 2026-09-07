-- Hero capture + a Prison, plus the Wall (a defending hero) that makes
-- capture-on-total-defeat a fair rule instead of an arbitrary one.
-- Safe to run any time: additive only, existing rows get sensible defaults.

-- Real hero identity/gear, synced for the first time (previously only bare
-- hero_levels numbers synced, no identity -- capture couldn't work without
-- this). hero_levels itself is untouched, still used elsewhere.
alter table players add column if not exists heroes jsonb not null default '[]'::jsonb;
-- which of those heroes are currently stationed on the Wall defending home.
alter table players add column if not exists wall_garrison jsonb not null default '[]'::jsonb;
-- this player's current Fortification research level, so resolve-raid can
-- apply the real defense bonus server-side.
alter table players add column if not exists fortification_level integer not null default 0;

-- Governor's Gate garrison previously only stored a bare hero LEVEL, no
-- identity -- needed now so a wiped garrison's hero can actually be captured.
alter table city_control add column if not exists garrison_hero_id integer;
alter table city_control add column if not exists garrison_hero_name text;

-- One row per captured hero. A hero is never permanently lost: the owner can
-- always eventually get them back (ransom, or once executed/timed out, a
-- cheap local revive) -- see pay-ransom and the Prison room.
create table if not exists prisoners (
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

-- the captor can end captivity early ("execute") any time, no reward --
-- just sets executed_at, same effect as the real 8-hour timeout elapsing.
create policy "the captor can execute a prisoner they hold"
  on prisoners for update
  to authenticated
  using (auth.uid() = captor_id)
  with check (auth.uid() = captor_id);

-- the owner can only free/delete the row themselves once it's genuinely
-- resolved (executed, or the real 8-hour window has passed) -- paying
-- ransom or using a Cyanide Pill bypasses this via pay-ransom's service
-- role instead, since those need to work at ANY point during captivity.
create policy "the owner can clear a resolved prisoner row"
  on prisoners for delete
  to authenticated
  using (auth.uid() = owner_id and (executed_at is not null or captured_at < now() - interval '8 hours'));

-- no insert policy on purpose -- only resolve-raid/seize-governor (service
-- role) ever create a capture.

-- History of ransoms paid, so a captor can see "while you were away, X paid
-- you a ransom" and credit their own local silver -- same pattern raid_log
-- already uses for stolen troops. Silver itself never touches the server
-- (see schema.sql's own header comment on why), so this is a durable record
-- the captor's own client applies locally, not a real balance.
create table if not exists ransom_log (
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

-- no insert policy on purpose -- only pay-ransom (service role) writes here
