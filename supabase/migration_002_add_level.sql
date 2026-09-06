-- Adds the account level to players — needed so real raid/seizure resolution
-- on the server can compute the same small per-level combat bonus the game
-- file already shows in its formation-modal preview (heroSkillMultiplier).
-- Safe to run any time: additive only, existing rows just default to 1.
alter table players add column if not exists level integer not null default 1;
