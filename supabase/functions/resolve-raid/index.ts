// Resolves a raid against a real player using the same composition-vs-
// composition combat math the game file previews client-side (see
// _shared/game-math.ts — MUST stay in sync with the HTML file's formula).
//
// A win pays the attacker a coin reward sized to the defender's actual
// standing defense, wounds a slice of the defender's ACTIVE garrison
// (proportional to the outcome band — a decisive win can wound most of it),
// and lets the attacker capture a cut of the defender's total wounded pool
// (pre-existing + just-wounded this raid). The defender's stored coins/
// resources are never touched. A loss is applied locally on the attacker's
// own phone (wounding the troops they sent), the same way an NPC raid loss
// already works — this function only needs to know the attacker's synced
// troop counts to validate the formation, not simulate their own losses.
//
// Hero capture (added alongside the Wall/Prison feature): if EITHER side's
// troops are wiped to exactly zero by this fight, that side's hero is
// captured by the winner. Defense now also factors in a Wall garrison (a
// hero stationed at home) and Fortification research, same as the game
// file's own preview math.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  TROOP_TYPES, roleProportions, effectiveAttack, effectiveDefense,
  heroSkillMultiplier, resolveCombatBand, applyDefenderLosses,
} from "../_shared/game-math.ts";

// fraction of the defender's TOTAL wounded pool (pre-existing + just wounded
// this raid) the attacker captures on a win
const STEAL_PCT = 0.2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fortificationMult(level: number): number {
  return 1 + Math.min(0.8, (level || 0) * 0.008);
}

function wallMult(wallGarrison: { id: number; name: string; level: number }[] | null, accountLevel: number): number {
  if (!wallGarrison || !wallGarrison.length) return 1;
  return Math.max(...wallGarrison.map((h) => heroSkillMultiplier(h.level, accountLevel)));
}

function totalActive(troops: Record<string, { active: number; wounded: number }>): number {
  return TROOP_TYPES.reduce((sum, t) => sum + (troops[t.key]?.active || 0), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not signed in." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not signed in." }, 401);

    const { defenderId, formation, heroId } = await req.json();
    if (!defenderId || !formation) return json({ error: "Missing defenderId or formation." }, 400);
    if (defenderId === user.id) return json({ error: "Can't raid yourself." }, 400);

    const sentTotal = TROOP_TYPES.reduce((sum, t) => sum + (formation[t.key] || 0), 0);
    if (sentTotal <= 0) return json({ error: "Send at least one troop." }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: attacker, error: attErr } = await admin.from("players").select("*").eq("id", user.id).single();
    if (attErr || !attacker) return json({ error: "Your player profile isn't set up yet — open the game and let it sync first." }, 400);

    for (const t of TROOP_TYPES) {
      if ((formation[t.key] || 0) > (attacker.troops[t.key]?.active || 0)) {
        return json({ error: `You don't have that many ${t.key}s available — try syncing first.` }, 400);
      }
    }

    const { data: defender, error: defErr } = await admin.from("players").select("*").eq("id", defenderId).single();
    if (defErr || !defender) return json({ error: "That player couldn't be found." }, 404);

    const heroLevel = Math.max(1, ...(attacker.hero_levels && attacker.hero_levels.length ? attacker.hero_levels : [1]));
    const attackPower = effectiveAttack(formation, roleProportions(defender.troops)) * heroSkillMultiplier(heroLevel, attacker.level || 1);
    const baseDefense = effectiveDefense(defender.troops);
    const defensePower = baseDefense * fortificationMult(defender.fortification_level) * wallMult(defender.wall_garrison, defender.level || 1);
    const ratio = defensePower > 0 ? attackPower / defensePower : (attackPower > 0 ? 99 : 0);
    const result = resolveCombatBand(ratio);

    let coinReward = 0;
    const stolen: Record<string, number> = {};
    let defenderHeroCaptured: { id: number; name: string; level: number } | null = null;
    let attackerHeroCaptured: { id: number; name: string; level: number } | null = null;
    let freedOwnCaptives = 0;

    if (result.won) {
      coinReward = Math.round(120 + defensePower * 1.5 + Math.random() * defensePower);

      const defenderTroops = JSON.parse(JSON.stringify(defender.troops));
      applyDefenderLosses(defenderTroops, result.defenderLossPct);
      TROOP_TYPES.forEach((t) => {
        const pool = defenderTroops[t.key];
        if (!pool) return;
        const take = Math.floor(pool.wounded * STEAL_PCT);
        if (take > 0) {
          pool.wounded -= take;
          stolen[t.key] = take;
        }
      });

      // optimistic check: if the defender's row changed since we read it,
      // skip applying losses/steal rather than risk a stale overwrite — the
      // coin reward still stands either way
      const { data: updated } = await admin.from("players")
        .update({ troops: defenderTroops, updated_at: new Date().toISOString() })
        .eq("id", defenderId)
        .eq("updated_at", defender.updated_at)
        .select()
        .single();
      if (!updated) {
        for (const k of Object.keys(stolen)) delete stolen[k];
      } else if (totalActive(defenderTroops) <= 0 && defender.wall_garrison && defender.wall_garrison.length) {
        // wiped out completely while a hero was stationed on the Wall —
        // that hero is captured. Multiple walled heroes are all captured.
        for (const h of defender.wall_garrison as { id: number; name: string; level: number }[]) {
          await admin.from("prisoners").insert({
            hero_id: h.id, hero_name: h.name, hero_level: h.level,
            owner_id: defenderId, captor_id: user.id,
          });
        }
        defenderHeroCaptured = defender.wall_garrison[0];
      }

      // captor vulnerability: the defender we just beat may themselves have
      // been holding OUR (or anyone's) hostages — losing badly enough to
      // get raided down means losing that leverage too.
      const { data: theirCaptives } = await admin.from("prisoners").select("id").eq("captor_id", defenderId);
      if (theirCaptives && theirCaptives.length) {
        await admin.from("prisoners").delete().eq("captor_id", defenderId);
        freedOwnCaptives = theirCaptives.length;
      }
    }

    if (!result.won && heroId != null) {
      const survived = TROOP_TYPES.reduce((sum, t) => {
        const sent = formation[t.key] || 0;
        if (sent <= 0) return sum;
        return sum + (sent - Math.round(sent * result.attackerLossPct));
      }, 0);
      if (survived <= 0) {
        const heroSnapshot = (attacker.heroes || []).find((h: { id: number }) => h.id === heroId);
        if (heroSnapshot) {
          await admin.from("prisoners").insert({
            hero_id: heroSnapshot.id, hero_name: heroSnapshot.name, hero_level: heroSnapshot.level,
            owner_id: user.id, captor_id: defenderId,
          });
          attackerHeroCaptured = heroSnapshot;
        }
      }
    }

    await admin.from("raid_log").insert({
      attacker_id: user.id,
      defender_id: defenderId,
      won: result.won,
      coin_reward: coinReward,
      troops_stolen: stolen,
    });

    return json({
      won: result.won,
      band: result.band,
      coinReward,
      stolen,
      attackerLossPct: result.attackerLossPct,
      defenderName: defender.display_name,
      defenderHeroCaptured,
      attackerHeroCaptured,
      freedOwnCaptives,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong resolving the raid." }, 500);
  }
});
