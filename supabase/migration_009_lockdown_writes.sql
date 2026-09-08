-- Two independent hardening fixes found by a code audit (2026-09-08), both
-- closing a gap between what an RLS policy actually allows and what it was
-- meant to allow. Safe to run any time.

-- ---------------------------------------------------------------------------
-- Fix 1 (her choice: "just do it") -- the "captor can execute a prisoner"
-- UPDATE policy only checked WHO was asking (auth.uid() = captor_id), never
-- WHICH column changed. Postgres RLS can't restrict a policy to one column,
-- so a captor could also rewrite captured_at (defeating the 8-hour
-- guaranteed-revive timeout) or owner_id (orphaning the row from its real
-- owner). Replaced with a `security definer` function that only ever sets
-- executed_at, exactly the one thing the client is actually meant to do --
-- same reasoning ransom/the Cyanide Pill already needed a real function for.
drop policy if exists "the captor can execute a prisoner they hold" on prisoners;

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

-- ---------------------------------------------------------------------------
-- Fix 2 (her choice: "option 2," a cheap plausibility tripwire, NOT a full
-- server-authoritative economy) -- the players table's own-row UPDATE policy
-- lets a signed-in client push any troops/power/heroes values it wants, and
-- resolve-raid/seize-governor trust that row as real combat input with zero
-- server-side check. Rather than rearchitecting the economy to be
-- server-authoritative (a much bigger project, and against this game's whole
-- "economy stays local" design), this adds one cheap, mathematically-safe
-- self-consistency check: the game's own powerRating() always sums the
-- troop-tierMult term (weight exactly 1) PLUS several other non-negative
-- contributors (Camp/Muster/research/gear/etc.), so an HONEST client's
-- pushed `power` can never be less than what its own pushed `troops` alone
-- would contribute. A row that fails this is either a naive stat edit or
-- broken client math -- either way, safe to reject outright. This does NOT
-- catch someone who inflates troops AND power consistently -- that's the
-- real security gap, and it's an accepted, discussed risk for this
-- invite-only family/friends game rather than something worth a full
-- rewrite for.
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
  -- small buffer, not a tight bound -- absorbs the client's own independent
  -- per-term rounding, this is a tripwire for gross tampering, not an exact
  -- reimplementation of powerRating()
  if new.power < troop_floor - 5 then
    raise exception 'players.power (%) is inconsistent with players.troops (implies at least %)', new.power, troop_floor;
  end if;
  return new;
end;
$$;

drop trigger if exists players_validate_profile_trigger on players;
create trigger players_validate_profile_trigger
  before insert or update on players
  for each row execute function players_validate_profile();
