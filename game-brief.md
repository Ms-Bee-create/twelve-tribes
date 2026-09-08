# Project Brief: Twelve Tribes — Current State & Next Steps

**Rewritten 2026-09-08** (superseding the old v25-era brief below this line — that one predates multiplayer, gear, research trees, hero capture, and most of what's actually here now. This version was compiled by Claude from the full session history rather than typed by hand, since the old one had drifted badly out of date. Worth a skim-through to confirm it still sounds right to you.)

## What this is

A live, hosted, real-multiplayer browser strategy game — Mafia-City/Rise-of-Kingdoms-style base builder with an Old Testament "Twelve Tribes" reskin (deliberately not "the good guys" — flawed people, matching a raiding/rivalry game). One self-contained HTML file, vanilla JS, canvas map + DOM overlays, no build tools. Real backend on Supabase.

**Play it live at:** https://ms-bee-create.github.io/twelve-tribes/
**Code:** `syndicate-prototype-v26.html` in this folder, pushed to the public GitHub repo `Ms-Bee-create/twelve-tribes`. Public code is fine — sign-in is invite-only server-side, so a stranger finding the URL can only ever play solo on their own device, never touch the real shared world.

**If you're picking this up fresh:** read this file, then check `C:\Users\amand\.claude\projects\...\memory\project_syndicate_game.md` (Claude's own memory of this project) for the full blow-by-blow history, specific bugs already found/fixed, and the reasoning behind non-obvious decisions.

## Theme vocabulary (for reading the code and talking to her about it)

Mansion→Camp, Foyer→The Tent, Barracks→Muster, Hospital→Healer's Tent, Warehouse→Storehouse, Garage→Oil Press (fuel→Oil), Armory→Forge, Heroes→Chieftains, Inventory→Provisions, Events→The Gathering, Research Lab→Scribes' Tent, Governor's Office→The City Gate, Cash→Silver, Food→Grain, Enforcer/Gunner/Driver→Shieldbearer/Archer/Rider, Stamina Potion→Skin of Wine. Internal code identifiers (troop keys like `enforcer1`, function/room names like `openMansion`/`GOVERNOR`) were deliberately left un-renamed — only user-facing text changed.

## Current feature set

**Map & camera** — 2900×1600 pannable/zoomable world, a Desert zone (slower travel, best tiles), mobile-correct viewport handling (`100dvh`, zoom scales down on narrow phones, labels hide during pan/pinch).

**Resource hubs** — 48 procedurally-generated tiles (seeded PRNG, same layout on every device), each with a real level 1-10 (not just a tier) that drives reserve size, regen time, and — the important structural piece — a hard per-tile gather-rate ceiling (`hubTroopCap`) so no army, however large, can ever push a tile's rate past what its own level allows.

**Combat targets** — 4 named lore "syndicates" + 12 generic scattered ones (NPC raid targets); 4 named lore rival mansions + 12 generic scattered ones + 3 live-scaling Boss Mansions (power/composition computed fresh off your own stats every time, composition leans into countering whatever troop role you're currently heaviest in). The City Gate (Governor's Office) is a contestable shared landmark — see Multiplayer below.

**Heroes (Chieftains)** — 3 recruitable (silver + `hero_recruitment` research gates #2/#3), each with their own level (cap 100), gear slot, and stamina (regens over time, grows with level/research/gear). Hero "Attack power" is a small hero-scoped number (base + gear, times a level-multiplier capped at level 100) — it does NOT include your troop stockpile. Heroless "Reinforcement" marches share the same deployment slots as heroes (base 3, + Logistics Corps research for more). **The Wall**: garrison a hero at home to defend (1 slot, 2 with research) — their skill multiplier now applies to home defense, closing what used to be a real fairness gap (attackers always got a hero multiplier, defenders didn't).

**Troops** — 3 roles (Shieldbearer/Archer/Rider) × 5 tiers each, real counter-triangle math shared between the client's odds preview and the server's real combat resolution. Tier unlocks need BOTH a Camp-level AND an `advanced_muster`-research threshold (mirrors how real tiered-troop games gate their top tiers). Losses split into wounded vs. permanently killed — locally 60/40 (further capped by Hospital capacity, see below), in real PvP 80/20 server-side. Every combat source (local attacks/raids, the Trial, real PvP both directions) now produces a full per-troop-type killed/wounded report, not just a "N lost" summary.

**Deployment size** (`maxDeployable()`) — how many troops one march can carry. Scales with Camp level + total research completed (base building + investment, same shape every comparable game uses), plus, as of 2026-09-07, the leading hero's own level (mirrors Rise of Kingdoms' commander-level term) and an equipped Blade of the Tribe's % bonus. A heroless Reinforcement march only gets the plain base.

**The Camp** — a real floor plan (canvas door-grid, not tabs), ~17 rooms. The Camp's own level is a real gate now, not decorative: Warehouse/Hospital/Oil Press/Scribes' Tent/all 3 field sites can never out-level it, and the Camp's own next level requires those 5 buildings to have already caught up (plus a hero-level requirement) — mirrors how Mafia City's mansion level and Rise of Kingdoms' City Hall both work as a hard ceiling. Every timed upgrade uses a `level^1.5` (build time) / `level^2.2` (resource cost) curve out to a hard `MAX_LEVEL = 100`.
- **Healer's Tent** — a real CAPACITY (wounded accumulate free until full, then overflow dies outright — Mafia City's actual mechanic), not a per-heal throughput limiter. A heal action can target the whole current wounded pool in one go.
- **Storehouse / Oil Press / 3 resource sites** (Lumber Yard, Threshing Floor, Cistern) — each resource site has its own independent plots AND its own overall site level (two separate progression tracks). Oil Press and the field sites buffer production (8h cap) and need manual Collect, standard mobile-city-builder pattern.
- **Forge** — crafts real, individually-owned, individually-tiered (1-3) gear instances: **Blade of the Tribe** (attack + march-size %), **Ward of the Covenant** (reduces this hero's own combat losses + boosts Hospital capacity while equipped), **Banner of Endurance** (max stamina), **Standard of the Gate** (attack+defense hybrid, materials only drop from winning a City Gate seizure). A piece worn by one hero is hard-unselectable for any other hero until unequipped or a separate copy is crafted — no auto-swap.
- **Scribes' Tent** — research, 5 trees (Economy, Arms, Crew, Defense, Hospital — modeled on Mafia City's real categories), each project a smooth 100-level curve, plus a few discrete milestone lines (Logistics Corps, Advanced Muster, Hero Recruitment, Wall Reinforcement) that grant a flat unlock per level instead of a %.
- **The Trial** — Mafia City's "Prison Break" pattern: no march/travel, 12 escalating stages vs. guards scaled off your own live power, 3 attempts/day. Gear materials are banded 4-stages-per-gear-type, so "clear stages 5-8 to farm Ward materials" is always literally true.
- **The Prison** — captured heroes (yours and ones you're holding), ransom/timeout-revive/self-release-via-Cyanide-Pill. See Multiplayer.
- **The Market** — Speedup Tokens, Resource Packs, temporary Deployment Capacity Boosts, temporary extra Build/Research queue slots, Convenience items (Skin of Wine, Hero XP Boost, Gear Material Bundle).
- **The Elders** — plain-language help page covering every building/mechanic.
- **Campfire** — shared live chat (Supabase Realtime push, <2s delivery), also always visible via a persistent bottom chat stripe outside the Camp.
- **Settings** — avatar picker, notification toggles, auto-open-Camp toggle, Reduce Motion, Sign Out. (Sound Effects toggle exists in the UI but has no audio engine behind it yet, on purpose — future work.)

**Meta systems** — quests, a weekly event with milestones, daily check-in, an inventory with loot drops + usable Skin of Wine, 5 formation presets (unlocked by account level), a Power rating that rolls up every system into one number — **tap the power badge to see the full itemized breakdown**, guaranteed to always match the displayed total since both are computed from the same list. The Watchtower (Reports room) is tabbed (All/Gathering/Combat/Building) with expandable per-entry detail, plus two pinned running-tally rows (Loot Drops, Resources Farmed) that update forever instead of scrolling away.

**Save system** — autosaves to `localStorage` constantly; manual export/import via a base64 sync code (The Tent). Offline progress is real: every timer, march, and passive-production system correctly fast-forwards based on real wall-clock time elapsed while the app was closed, not just "however long the tab happened to stay in memory."

## Multiplayer (real, not cosmetic)

Backend: Supabase, project ref `imbsawidozpvwpczqgbz`. Sign-in is invite-only (dashboard-created users only, no public signup). Your real economy (coins, resources, building levels) stays purely local/client-only — only a small public profile (position, power, troop counts, heroes, wall garrison, Camp level) syncs to the shared `players` table, which is how the shared map and PvP work without a full server rewrite.

- **Real players render live on the shared map** — position, an icon that scales with their real Camp level, and (recently) live walking/march interpolation, not just a static dot.
- **Real PvP raiding** (`resolve-raid` edge function) — win pays coins sized to the defender's actual standing defense, wounds/kills a real slice of their garrison (Hospital-capacity-aware on the attacker's own preview, flat 80/20 server-side for the defender), steals a cut of their wounded pool, and can capture a hero on a total wipe. The loser's own "while you were away" report is exactly as detailed as the attacker's real-time one (full per-troop-type breakdown).
- **The City Gate** (`city_control`, one single shared row) — real contested seizure. Defense is computed from whatever the current holder actually left garrisoned there (troops, and optionally a hero, whose skill multiplier applies) — not a snapshot of their home army. A garrisoned hero can be captured on total wipe, same as the Wall; `abandon-governor` lets a garrisoned hero come home voluntarily.
- **The Prison / hero capture / ransom** — a hero is never permanently lost. Execute/ransom/timeout-revive are self-service, enforced entirely by RLS policies (Postgres checks eligibility, not client trust); only the actual silver transfer (ransom) and the early-bypass (Cyanide Pill) go through a privileged edge function (`pay-ransom`), using the same "catch up on what happened while away" pattern raids use, since silver itself never lives server-side.
- **Shared live chat** (Campfire) via Supabase Realtime.
- Two throwaway test accounts (`synd.test.alpha@gmail.com` / `synd.test.bravo@gmail.com`, password `TestPass123!`) exist for testing without disturbing real players — ask before deleting them.

## How this was built (context for you)

Iteratively, feature-by-feature, in long live sessions — describe something, it gets built, tested against the actual running game (console math checks + the Browser-pane tool + real phone screenshots when something looked mobile-specific), then shipped. A lot of the numeric balance (costs, timers, power formulas) has been deliberately researched against real comparable games (Mafia City, Rise of Kingdoms, Evony) rather than guessed — when a number "feels wrong," the fix has consistently been to find what the real game actually does before changing it, since more than once the instinct to nerf/cap something turned out to be wrong versus how the genre actually handles it. Feel free to refactor for maintainability, but don't change *behavior* without checking first — see "My working style" below.

## What's actually outstanding right now (2026-09-08)

No big feature list is queued — the original "Big" deferred list (hero-stealing+Prison, the economy pass, viewing her husband's real camp, the Trial) is fully done, and the most recent bundled follow-on (hospital rework, 5 research trees, real gear instances, combat reports) is done too. Soft, worth-knowing gaps:

1. **Gate-garrison hero capture** (the City Gate equivalent of the Wall's proven hero-capture path) is code-complete and same-shape as the Wall path that WAS live-tested, but has never been independently fired for real — the Gate is a single shared row currently held by a real player, so testing it isn't clean right now. Revisit next time it's naturally unheld or held by a test account with a garrisoned hero.
2. Any already-orphaned "ghost base" rows from a since-fixed position-sync bug (2026-09-06) were never manually checked/cleaned from the live `players` table.
3. Her husband's and son's devices need to be on the real hosted URL, not an old local file copy, to have picked up months of fixes.
4. Sound Effects toggle in Settings has no audio behind it yet (deliberate).

Otherwise: open to whatever she wants to tackle next. Ask before any big structural change; small stuff can just be handled and reported after — same standing preference as always.

## My working style

Not a developer. Plain language, no assumed terminal/CLI familiarity beyond what I've already picked up. I care about *understanding* what's happening in broad strokes, not necessarily every implementation detail. Ask me before big structural changes; feel free to just handle small stuff and tell me what you did after. I want things researched against real, comparable games before you implement a balance number from scratch or "fix" something that looks off — more than once that's caught you about to do the wrong thing.

**Every session should commit + push after shipping a change** (`git add -A && git commit -m "..." && source .tools/.env && git push "https://${GITHUB_TOKEN}@github.com/Ms-Bee-create/twelve-tribes.git" main:main`), or the live site quietly drifts behind local edits.
