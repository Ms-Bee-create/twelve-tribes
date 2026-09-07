// Resolves an attempt to seize the shared Governor's Office, using the same
// composition-vs-composition combat math as resolve-raid (see
// _shared/game-math.ts). Defense is computed from the real garrison the
// current holder actually left behind (city_control.garrison) — the troops
// that seized it and stayed, whose hero also stays and lends their skill —
// not a snapshot of the holder's home army. That's what makes holding the
// city a real standing commitment: taking it means fighting through
// whatever the holder actually committed, not just attacking them out of it.
// When unheld (or held with an empty garrison, which shouldn't normally
// happen), defense falls back to a baseline "city guard" composition/power
// that mirrors GOVERNOR.composition/power in the game file.
//
// On a win, the ATTACKER's surviving formation (after their own losses)
// becomes the new garrison — the old garrison is wounded/killed by the
// defender-loss share, same math as any other fight, and simply replaced.
//
// Uses an optimistic check on the city_control write so that if two people
// attempt a seizure at nearly the same moment, only the one that actually
// lands first sticks.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  TROOP_TYPES, roleProportions, effectiveAttack, effectiveDefense,
  heroSkillMultiplier, resolveCombatBand, applyDefenderLosses,
} from "../_shared/game-math.ts";

const BASELINE_COMPOSITION = { enforcer: 0.34, gunner: 0.33, driver: 0.33 }; // mirrors GOVERNOR.composition in the game file
const GOVERNOR_CYCLE_MS = 8 * 60 * 1000; // keep in sync with GOVERNOR_CYCLE_MS in the game file

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

    const { formation, heroId } = await req.json();
    if (!formation) return json({ error: "Missing formation." }, 400);

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

    const { data: city, error: cityErr } = await admin.from("city_control").select("*").eq("id", 1).single();
    if (cityErr || !city) return json({ error: "City state is missing — contact the admin." }, 500);
    if (city.held_by === user.id) return json({ error: "You already hold the city." }, 400);

    const garrison: Record<string, { active: number; wounded: number }> | null =
      city.held_by && city.garrison && Object.keys(city.garrison).length ? city.garrison : null;

    let defensePower = city.power;
    let defenseComposition = BASELINE_COMPOSITION;
    if (garrison) {
      const garrisonHeroMult = heroSkillMultiplier(city.garrison_hero_level || 1, city.garrison_account_level || 1);
      defensePower = effectiveDefense(garrison) * garrisonHeroMult;
      defenseComposition = roleProportions(garrison) || BASELINE_COMPOSITION;
    }

    const heroLevel = Math.max(1, ...(attacker.hero_levels && attacker.hero_levels.length ? attacker.hero_levels : [1]));
    const attackPower = effectiveAttack(formation, defenseComposition) * heroSkillMultiplier(heroLevel, attacker.level || 1);
    const ratio = defensePower > 0 ? attackPower / defensePower : (attackPower > 0 ? 99 : 0);
    const result = resolveCombatBand(ratio);

    let oldGarrisonHeroCaptured: { id: number; name: string; level: number } | null = null;
    let seizerHeroCaptured: { id: number; name: string; level: number } | null = null;

    if (result.won) {
      // the old garrison (if any) takes the defender-loss share — it's being
      // fully replaced either way, this is just for an honest power number
      // in the response and isn't written anywhere the old holder can see
      if (garrison) applyDefenderLosses(garrison, result.defenderLossPct);

      // if the old garrison was wiped to zero, its hero is captured by the
      // seizer — same "total defeat" rule as regular raiding
      if (garrison && city.garrison_hero_id) {
        const oldGarrisonSurvived = TROOP_TYPES.reduce((sum, t) => sum + (garrison[t.key]?.active || 0), 0);
        if (oldGarrisonSurvived <= 0) {
          await admin.from("prisoners").insert({
            hero_id: city.garrison_hero_id, hero_name: city.garrison_hero_name, hero_level: city.garrison_hero_level || 1,
            owner_id: city.held_by, captor_id: user.id,
          });
          oldGarrisonHeroCaptured = { id: city.garrison_hero_id, name: city.garrison_hero_name, level: city.garrison_hero_level || 1 };
        }
      }

      // the attacker's SURVIVING formation becomes the new garrison
      const newGarrison: Record<string, { active: number; wounded: number }> = {};
      TROOP_TYPES.forEach((t) => {
        const sent = formation[t.key] || 0;
        if (sent <= 0) return;
        const survived = sent - Math.round(sent * result.attackerLossPct);
        if (survived > 0) newGarrison[t.key] = { active: survived, wounded: 0 };
      });

      const heroSnapshot = heroId != null ? (attacker.heroes || []).find((h: { id: number }) => h.id === heroId) : null;

      // optimistic check — someone else may have just taken it. SQL `=` never
      // matches NULL, so an unheld city (held_by IS NULL) needs `.is()`, not `.eq()`.
      let query = admin.from("city_control")
        .update({
          held_by: user.id,
          power: Math.round(defensePower),
          garrison: newGarrison,
          garrison_hero_level: heroLevel,
          garrison_account_level: attacker.level || 1,
          garrison_hero_id: heroSnapshot ? heroSnapshot.id : null,
          garrison_hero_name: heroSnapshot ? heroSnapshot.name : null,
          cycle_ends_at: new Date(Date.now() + GOVERNOR_CYCLE_MS).toISOString(),
        })
        .eq("id", 1);
      query = city.held_by ? query.eq("held_by", city.held_by) : query.is("held_by", null);
      const { data: updated } = await query.select().single();
      if (!updated) {
        return json({ won: false, contested: true, attackerLossPct: result.attackerLossPct, cityPower: Math.round(defensePower) });
      }
    } else if (heroId != null && city.held_by) {
      // the seizer lost — if their OWN sent formation was wiped, the current
      // holder captures the seizer's hero
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
            owner_id: user.id, captor_id: city.held_by,
          });
          seizerHeroCaptured = heroSnapshot;
        }
      }
    }

    return json({
      won: result.won,
      band: result.band,
      attackerLossPct: result.attackerLossPct,
      cityPower: Math.round(defensePower),
      oldGarrisonHeroCaptured,
      seizerHeroCaptured,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong seizing the office." }, 500);
  }
});
