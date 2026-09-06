-- Adds an optional "march snapshot" to players — lets other players' clients
-- see a hero actually walking across the map (interpolated locally from these
-- six numbers, the same way this game already animates your own hero's
-- marches) instead of just a static camp position. All nullable: a player who
-- isn't currently marching just has every one of these as null.
-- Safe to run any time: additive only, existing rows are unaffected.
--
-- IMPORTANT: run this BEFORE the client code that pushes these columns ships,
-- or every profile push (including the existing position/troops/level fields)
-- will fail validation and stop syncing until this migration is applied.
alter table players add column if not exists march_from_x double precision;
alter table players add column if not exists march_from_y double precision;
alter table players add column if not exists march_to_x double precision;
alter table players add column if not exists march_to_y double precision;
alter table players add column if not exists march_depart_at bigint; -- epoch ms (Date.now()-based), not performance.now()
alter table players add column if not exists march_arrive_at bigint;
