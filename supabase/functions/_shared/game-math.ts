// Shared between resolve-raid and seize-governor. This MUST stay byte-for-byte
// equivalent to the combat math in syndicate-prototype-v26.html (TROOP_TYPES,
// ROLE_ATTACK/ROLE_DEFENSE, COUNTERS, effectiveAttack/effectiveDefense,
// resolveCombatBand, distributeCasualties) — if that formula changes in the
// game file, it has to change here too, or the formation modal's preview
// will lie about what the server actually resolves. Redeploy both functions
// after any change here.

// Soft exponential (saturating) curve: tierMult(1) = 1.0 and each further
// tier closes most of the remaining gap to TIER_CEIL rather than adding a
// fixed/growing chunk. Old table (1, 2, 3.5, 5, 7, 9.5) let a Tier 6 stack
// hit ~9.5x a Tier 1 stack of the same size, so a handful of high-tier units
// could steamroll a much larger low-tier defense outright. This "tier
// squashing" keeps early-game troops meaningfully relevant while still
// making each tier upgrade feel rewarding (diminishing, not disappearing).
const TIER_CEIL = 7.5;
const TIER_CURVE_K = 0.35;
function softTierMult(tier: number): number {
  return 1 + (TIER_CEIL - 1) * (1 - Math.exp(-TIER_CURVE_K * (tier - 1)));
}

export const TROOP_TYPES: { key: string; role: "enforcer" | "gunner" | "driver"; tierMult: number }[] = (() => {
  const roles: Array<"enforcer" | "gunner" | "driver"> = ["enforcer", "gunner", "driver"];
  const tiers = [1, 2, 3, 4, 5, 6];
  const list: { key: string; role: "enforcer" | "gunner" | "driver"; tierMult: number }[] = [];
  roles.forEach((role) => tiers.forEach((tier) => list.push({ key: `${role}${tier}`, role, tierMult: softTierMult(tier) })));
  return list;
})();

export const ROLE_ATTACK: Record<string, number> = { enforcer: 0.6, gunner: 1.0, driver: 0.8 };
export const ROLE_DEFENSE: Record<string, number> = { enforcer: 1.2, gunner: 0.6, driver: 0.7 };
// rock-paper-scissors: Enforcer > Gunner > Driver > Enforcer
const COUNTERS: Record<string, string> = { enforcer: "gunner", gunner: "driver", driver: "enforcer" };

type Formation = Record<string, number>;
type TroopsObj = Record<string, { active: number; wounded: number }>;
type RoleProportions = { enforcer: number; gunner: number; driver: number };

// Counter Triangle tuning: a straight 1.5x/0.65x swing (a 2.3x spread between
// winning and losing the matchup) let a big enough advantaged stack ignore
// tier and raw numbers entirely. Flattened to a clean +/-20% modifier (within
// the intended 15-30% band) — advantage still matters, but it's a nudge on
// top of tier/numbers rather than the deciding factor by itself.
const COUNTER_BONUS = 0.2;
function counterMultiplier(attackRole: string, defendRole: string): number {
  if (attackRole === defendRole) return 1.0;
  if (COUNTERS[attackRole] === defendRole) return 1 + COUNTER_BONUS;
  return 1 - COUNTER_BONUS;
}

export function roleProportions(troops: TroopsObj): RoleProportions | null {
  const sums = { enforcer: 0, gunner: 0, driver: 0 };
  TROOP_TYPES.forEach((t) => { sums[t.role] += troops[t.key]?.active ?? 0; });
  const total = sums.enforcer + sums.gunner + sums.driver;
  if (total <= 0) return null;
  return { enforcer: sums.enforcer / total, gunner: sums.gunner / total, driver: sums.driver / total };
}

function weightedCounterMultiplier(attackRole: string, proportions: RoleProportions | null): number {
  if (!proportions) return 1.0;
  return (["enforcer", "gunner", "driver"] as const).reduce(
    (sum, role) => sum + (proportions[role] || 0) * counterMultiplier(attackRole, role), 0);
}

// heroMult (from heroSkillMultiplier) is applied per-troop, right alongside
// tierMult/ROLE_ATTACK — i.e. it's baked into each individual unit's own
// attack stat, not tacked on afterward as a separate multiply against the
// march's total. Same number for a single march (multiplication distributes
// over the sum either way), but it means a hero's level/gear buff can never
// be applied twice, or against a pool of troops wider than the formation
// actually sent, by accident.
export function effectiveAttack(formation: Formation, opponentProportions: RoleProportions | null, heroMult = 1): number {
  return TROOP_TYPES.reduce((sum, t) => {
    const sent = formation[t.key] || 0;
    if (!sent) return sum;
    return sum + sent * t.tierMult * ROLE_ATTACK[t.role] * weightedCounterMultiplier(t.role, opponentProportions) * heroMult;
  }, 0);
}

export function effectiveDefense(troops: TroopsObj): number {
  return TROOP_TYPES.reduce((sum, t) => sum + (troops[t.key]?.active ?? 0) * t.tierMult * ROLE_DEFENSE[t.role], 0);
}

// Must mirror the game file's own MAX_LEVEL=100 cap on both inputs (see its
// heroSkillMultiplier) -- account level in particular has NO ceiling in
// normal XP progression, so any long-lived real account will eventually
// exceed 100 through ordinary honest play, not just a forged value. Without
// this cap the server's real combat resolution would silently diverge from
// what the client's own (capped) odds preview showed that same player.
const MAX_LEVEL = 100;
export function heroSkillMultiplier(heroLevel: number, accountLevel: number): number {
  const heroLvl = Math.min(MAX_LEVEL, heroLevel);
  const acctLvl = Math.min(MAX_LEVEL, accountLevel);
  return 1 + (heroLvl - 1) * 0.05 + (acctLvl - 1) * 0.02;
}

export type CombatBand = "decisive" | "solid" | "costly" | "clear";
export interface CombatResult { band: CombatBand; won: boolean; attackerLossPct: number; defenderLossPct: number; }

export function resolveCombatBand(ratio: number): CombatResult {
  const r = ratio * (0.9 + Math.random() * 0.2);
  if (r >= 1.4) return { band: "decisive", won: true, attackerLossPct: 0.05, defenderLossPct: 0.6 };
  if (r >= 1.0) return { band: "solid", won: true, attackerLossPct: 0.12, defenderLossPct: 0.35 };
  if (r >= 0.75) return { band: "costly", won: false, attackerLossPct: 0.35, defenderLossPct: 0.10 };
  return { band: "clear", won: false, attackerLossPct: 0.55, defenderLossPct: 0.03 };
}

// Defending losses are mostly wounded but not all — 20% are killed outright
// (no `.wounded` destination, and therefore not stealable by a raider either).
// Flat for now; research-based mitigation is a deliberate later addition.
const DEFENDER_KILL_SHARE = 0.2;

// Casualty Control: no single troop TYPE can lose more than this fraction of
// its own active count in one combat round. Without this, draining lossPct
// front-to-back through TROOP_TYPES (ascending tier) could fully wipe out a
// defender's entire Tier 1 stack before a single higher-tier unit was ever
// touched — early-tier troops were disposable padding instead of a real
// part of the defense. Distributing proportionally-by-composition (with this
// cap) means every tier absorbs its fair share and none gets erased outright.
const CASUALTY_CAP_PCT = 0.6;

// Splits `lossPct` of `totalActive` across `pools` (each {key, active}) in
// proportion to their share of the army, capped per-pool at CASUALTY_CAP_PCT
// of that pool's own active count. Any shortfall left over after capping
// (because the capped pools couldn't absorb their full proportional share)
// is redistributed to whichever pools still have headroom, largest headroom
// first — so the total lost still tracks lossPct as closely as the caps
// allow, instead of just silently under-delivering the loss.
export function distributeCasualties(pools: { key: string; active: number }[], lossPct: number): Record<string, number> {
  const totalActive = pools.reduce((sum, p) => sum + p.active, 0);
  const hits: Record<string, number> = {};
  if (totalActive <= 0) return hits;
  const desiredTotal = Math.min(totalActive, Math.round(totalActive * lossPct));
  let allocated = 0;
  pools.forEach((p) => {
    if (p.active <= 0) return;
    const proportional = Math.round((p.active / totalActive) * desiredTotal);
    const capped = Math.min(proportional, Math.floor(p.active * CASUALTY_CAP_PCT));
    if (capped > 0) { hits[p.key] = capped; allocated += capped; }
  });
  let shortfall = desiredTotal - allocated;
  if (shortfall > 0) {
    const room = pools
      .map((p) => ({ key: p.key, room: Math.floor(p.active * CASUALTY_CAP_PCT) - (hits[p.key] || 0) }))
      .filter((r) => r.room > 0)
      .sort((a, b) => b.room - a.room);
    for (const r of room) {
      if (shortfall <= 0) break;
      const add = Math.min(r.room, shortfall);
      hits[r.key] = (hits[r.key] || 0) + add;
      shortfall -= add;
    }
  }
  return hits;
}

export interface LossBreakdown { killed: Record<string, number>; wounded: Record<string, number>; }

// Distributes lossPct of the defender's TOTAL active troops via
// distributeCasualties (proportional-by-composition, capped per tier — see
// its own comment) rather than draining front-to-back through TROOP_TYPES.
// Returns a real per-troop-type killed/wounded breakdown -- lets the
// defender's own "while you were away" report be just as detailed as the
// attacker's, mirroring the game file's own formatLossDetail().
export function applyDefenderLosses(defender: TroopsObj, lossPct: number): LossBreakdown {
  const killed: Record<string, number> = {};
  const wounded: Record<string, number> = {};
  const pools = TROOP_TYPES.map((t) => ({ key: t.key, active: defender[t.key]?.active ?? 0 }));
  const hits = distributeCasualties(pools, lossPct);
  Object.entries(hits).forEach(([key, hit]) => {
    if (hit <= 0) return;
    const pool = defender[key];
    if (!pool) return;
    const k = Math.round(hit * DEFENDER_KILL_SHARE);
    const w = hit - k;
    pool.active -= hit;
    pool.wounded += w;
    if (k > 0) killed[key] = k;
    if (w > 0) wounded[key] = w;
  });
  return { killed, wounded };
}
