-- Lets the defender's own "while you were away" report be just as
-- detailed as the attacker's real-time one -- a real per-troop-type
-- killed/wounded breakdown, same shape the game file's own
-- formatLossDetail() already builds for the attacker's side.
-- Safe to run any time: additive only, existing rows default to empty.
alter table raid_log add column if not exists defender_losses jsonb not null default '{}'::jsonb;
