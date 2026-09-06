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

    const { defenderId, formation } = await req.json();
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
    const defensePower = effectiveDefense(defender.troops);
    const ratio = defensePower > 0 ? attackPower / defensePower : (attackPower > 0 ? 99 : 0);
    const result = resolveCombatBand(ratio);

    let coinReward = 0;
    const stolen: Record<string, number> = {};

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
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong resolving the raid." }, 500);
  }
});
