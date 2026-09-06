# Project Brief: Syndicate — Current State & Next Steps

## What this is

A single-player (soon-to-be-multiplayer) browser strategy game, "Syndicate" — a
Mafia-City/World-War-Rising-style base builder. One self-contained HTML file,
vanilla JS, no build tools or frameworks. Canvas for the map, DOM overlays for
the HUD/menus. Currently at `syndicate-prototype-v25.html`.

**Note:** an earlier brief (`multiplayer-brief.md`) was written several
versions ago and is now out of date on the specifics — this document
supersedes it. The multiplayer goal described there (Supabase-backed, raid
each other's mansions) is still the eventual target, but a lot of single-player
depth got built first. Read this one, not the old one, for current state.

## Current feature set (as of v25)

**Map & camera**
- Large pannable/zoomable world (2300×1400), drag to pan, pinch/scroll-wheel
  to zoom, +/− buttons as a fallback
- A "Desert" zone (sandy, visually distinct) where travel is slower but the
  best resource tiles live
- Live coordinate readout (bottom-right) and per-entity coordinate labels,
  since part of the fun is intentionally *hunting* for things rather than
  everything being signposted
- No tracer lines to every possible destination (removed — felt cluttered)
  but a live per-hero "trail" line appears from the mansion to wherever a
  hero currently is, only while they're out on a mission

**Heroes**
- 3 recruitable heroes (Vega/Marlowe/Ruiz), each with individual levels
  (upgraded in the Heroes room), distinct outfit colors/weapons
- Top-right portrait row for selection; auto-advances to the next idle hero
  fairly (round-robin, not always-lowest-id) when you dispatch one
- Stamina system gating actions

**Troops — a real 3-type formation system**
- Enforcers (front line, tank), Gunners (mid line, damage), Drivers (back
  line, speed + crit chance) — trained in the Barracks, each with their own
  batch-training timer
- **Formation prompt**: attacking a syndicate, raiding a rival mansion, or
  seizing the Governor's Office now pops a modal where you choose how many
  of each troop type to actually send on that specific march (steppers +
  Max buttons, live power preview). Only the troops sent are used for that
  fight's power, and only they're at risk if it goes badly — the rest of
  your army stays safe at home. This is the most recently built system and
  the one most likely to still have rough edges worth testing.
- Wounded troops go to the Hospital (heal over time, don't just vanish)

**Mansion — a real floor plan, not flat tabs**
Rooms: Foyer, Barracks, Hospital, Warehouse, Garage, Armory, Heroes,
Inventory, Events. Navigation is a visual door-grid, not a tab bar. Each
room has its own themed background. Full-screen view (not a popup card).

- **Garage** (newest room): produces Fuel over time. Fuel is spent to
  **relocate the mansion** — tap "Relocate," a confirm prompt shows cost/
  coordinates, then tap anywhere on the map (with validation against edges/
  overlapping other things) to move your home base there. Has a cooldown.
- **Warehouse**: raises the cap on how much of each resource you can hold
- All room upgrades cost coins + specific resources + real time (with a
  "Rush" option to pay coins to skip the wait)

**Resources**: Cash (spendable currency), Lumber, Food, Water, Fuel — each
capped by Warehouse level, generated from map resource hubs (3 tiers: near/
weak, mid, and Desert/best) except Fuel which only comes from the Garage.

**Combat targets**
- 4 fixed-tier "Syndicate" NPCs (health-bar based, chip damage per hit, full
  relocation to a wide roaming region — bigger regions for tougher tiers —
  after every kill)
- 4 "Rival Mansion" NPCs (scout to reveal power, then raid — binary win/
  lose, also relocate + require re-scouting after each defeat)
- The **Governor's Office**: a contestable landmark, scout → seize, resets
  on a cycle (demo-speed "every 3 days"), holder gets a passive bonus

**Meta systems**: quests, a weekly event with milestone rewards, daily
check-in, an inventory with loot drops and a usable Stamina Potion, a
"Power" rating that rolls up every upgrade path into one number (shown in
the HUD).

**Save system**
- Autosaves to `localStorage` every few seconds
- Manual export/import: generates a base64-JSON "sync code" you copy between
  devices (Foyer room) — this is the *only* current way to move progress
  between your PC and phone; it's one-way (whichever code you load last wins,
  no merging)
- `buildSavePayload()` / `applySavePayload()` are the two functions that
  serialize/restore literally everything — this is your best single
  reference for "what does full game state look like" if/when you build
  real multiplayer sync

## How this was built (context for you)

Built live, iteratively, over one very long session in a Claude.ai chat
(not Claude Code) — I'd describe a feature, it'd write the HTML/CSS/JS
inline, we'd version-bump the filename each round (v1 → v25), and I'd test
on my phone via a "sync code" workaround since there was no direct file
transfer. That means: the code works and has been genuinely playtested, but
it was built more for "does this feel fun right now" than for long-term
maintainability. Feel free to refactor/clean up as you go — just don't
change *behavior* without checking with me first, since a lot of the current
numbers (costs, timers, power formulas) were tuned by feel through actual
play, not calculated.

## What I want to do next (rough priority order — ask me before assuming)

1. **Keep testing/polishing what exists** — the formation system especially
   is brand new and I haven't stress-tested it much yet
2. **Eventually**: the multiplayer build described in the old brief — real
   backend (Supabase, free tier is plenty), shared world, raid my husband's
   actual mansion instead of only NPCs
3. Open to your suggestions on anything that feels rough, undertested, or
   like it's accumulating complexity debt — you're now looking at this with
   fresh eyes in a way I can't

## My working style

Not a developer. Plain language, no assumed terminal/CLI familiarity beyond
what I've already picked up. I care about *understanding* what's happening
in broad strokes, not necessarily every implementation detail. Ask me before
big structural changes; feel free to just handle small stuff and tell me
what you did after.
