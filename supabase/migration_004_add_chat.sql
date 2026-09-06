-- Adds a shared chat table so signed-in players can actually talk, not just
-- see each other on the map. Same read-all/insert-own-only shape as raid_log,
-- plus one extra step: adding the table to the supabase_realtime publication,
-- which is what lets new messages push live to other players instead of only
-- being visible on their next poll.
-- Safe to run any time: purely additive, doesn't touch any existing table.
create table if not exists chat_messages (
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

-- required for realtime delivery — without this, new messages are only
-- visible via a fresh select, never pushed live to open subscriptions
alter publication supabase_realtime add table chat_messages;
