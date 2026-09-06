// Shared between resolve-raid and seize-governor. This MUST stay byte-for-byte
// equivalent to the combat math in syndicate-prototype-v26.html (TROOP_TYPES,
// ROLE_ATTACK/ROLE_DEFENSE, COUNTERS, effectiveAttack/effectiveDefense,
// resolveCombatBand) — if that formula changes in the game file, it has to
// change here too, or the formation modal's preview will lie about what the
// server actually resolves. Redeploy both functions after any change here.

export const TROOP_TYPES: { key: string; role: "enforcer" | "gunner" | "driver"; tierMult: number }[] = (() => {
  const roles: Array<"enforcer" | "gunner" | "driver"> = ["enforcer", "gunner", "driver"];
  const tiers = [
    { tier: 1, tierMult: 1.0 },
    { tier: 2, tierMult: 2.0 },
    { tier: 3, tierMult: 3.5 },
    { tier: 4, tierMult: 5.0 },
    { tier: 5, tierMult: 7.0 },
  ];
  const list: { key: string; role: "enforcer" | "gunner" | "driver"; tierMult: number }[] = [];
  roles.forEach((role) => tiers.forEach((t) => list.push({ key: `${role}${t.tier}`, role, tierMult: t.tierMult })));
  return list;
})();

export const ROLE_ATTACK: Record<string, number> = { enforcer: 0.6, gunner: 1.0, driver: 0.8 };
export const ROLE_DEFENSE: Record<string, number> = { enforcer: 1.2, gunner: 0.6, driver: 0.7 };
// rock-paper-scissors: Enforcer > Gunner > Driver > Enforcer
const COUNTERS: Record<string, string> = { enforcer: "gunner", gunner: "driver", driver: "enforcer" };

type Formation = Record<string, number>;
type TroopsObj = Record<string, { active: number; wounded: number }>;
type RoleProportions = { enforcer: number; gunner: number; driver: number };

function counterMultiplier(attackRole: string, defendRole: string): number {
  if (attackRole === defendRole) return 1.0;
  if (COUNTERS[attackRole] === defendRole) return 1.5;
  return 0.65;
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

export function effectiveAttack(formation: Formation, opponentProportions: RoleProportions | null): number {
  return TROOP_TYPES.reduce((sum, t) => {
    const sent = formation[t.key] || 0;
    if (!sent) return sum;
    return sum + sent * t.tierMult * ROLE_ATTACK[t.role] * weightedCounterMultiplier(t.role, opponentProportions);
  }, 0);
}

export function effectiveDefense(troops: TroopsObj): number {
  return TROOP_TYPES.reduce((sum, t) => sum + (troops[t.key]?.active ?? 0) * t.tierMult * ROLE_DEFENSE[t.role], 0);
}

export function heroSkillMultiplier(heroLevel: number, accountLevel: number): number {
  return 1 + (heroLevel - 1) * 0.05 + (accountLevel - 1) * 0.02;
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

// moves lossPct of each present tier in troops-object `defender` (proportionally)
// from active into wounded (minus the killed share), in place, and returns how
// many tier-keys moved so callers can decide whether the update is worth writing back
export function applyDefenderLosses(defender: TroopsObj, lossPct: number): Record<string, number> {
  const moved: Record<string, number> = {};
  TROOP_TYPES.forEach((t) => {
    const pool = defender[t.key];
    if (!pool || pool.active <= 0) return;
    const hit = Math.round(pool.active * lossPct);
    if (hit <= 0) return;
    const killed = Math.round(hit * DEFENDER_KILL_SHARE);
    const wounded = hit - killed;
    pool.active -= hit;
    pool.wounded += wounded;
    moved[t.key] = hit;
  });
  return moved;
}
