-- Adds each player's Camp (mansion) level to the shared table, so other
-- players' bases on the map can actually show/scale with their real
-- progress instead of every other player always rendering as the same
-- fixed small icon regardless of how far along they are.
-- Safe to run any time: additive only, existing rows just default to 1.
alter table players add column if not exists mansion_level integer not null default 1;
