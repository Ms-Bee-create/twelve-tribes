-- The Loudspeaker (Market item, 200 silver): broadcasts a message across
-- every online player's screen in real time. Same shape and RLS as
-- chat_messages (read-all-authenticated, insert-only-as-yourself), delivered
-- live via Supabase Realtime rather than the 25s poll cycle everything else
-- uses -- an announcement needs to feel instant, same reasoning chat already
-- established. Deliberately ephemeral: no "catch up on missed announcements"
-- path, only players actually online when it fires see it, matching how a
-- real game's own world-announcement banners work. Safe to run any time.

create table loudspeaker_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references players(id) on delete cascade,
  display_name text not null,
  text text not null check (char_length(text) between 1 and 120),
  created_at timestamptz not null default now()
);

alter table loudspeaker_messages enable row level security;

create policy "loudspeaker messages are readable by any signed-in player"
  on loudspeaker_messages for select
  to authenticated
  using (true);

create policy "players can only send loudspeaker messages as themselves"
  on loudspeaker_messages for insert
  to authenticated
  with check (auth.uid() = sender_id);

alter publication supabase_realtime add table loudspeaker_messages;
