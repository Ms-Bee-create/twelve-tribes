-- Gives the City Gate a real garrison: the troop counts (and the hero level
-- of whoever's leading them) that actually stayed behind when someone seized
-- it, instead of computing defense from a snapshot of the holder's home army
-- (players.troops). That old approach meant taking the city was never
-- actually fighting through anything the holder had committed to defending
-- it — this makes holding it a real, standing commitment.
--
-- Safe to run any time: purely additive, existing rows are unaffected
-- (defaults to an empty garrison, which seize-governor already treats the
-- same as "unheld" for defense purposes).
alter table city_control add column if not exists garrison jsonb not null default '{}'::jsonb;
alter table city_control add column if not exists garrison_hero_level integer not null default 1;
alter table city_control add column if not exists garrison_account_level integer not null default 1;
