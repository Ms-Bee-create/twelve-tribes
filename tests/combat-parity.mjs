// Run: node tests/combat-parity.mjs
// Pulls the combat block straight out of the game HTML and checks it matches
// supabase/functions/_shared/game-math.ts number-for-number, then spot-checks
// the counter-triangle balance rules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "syndicate-prototype-v26.html"), "utf8");
const start = html.indexOf("const ROLE_DESC");
const end = html.indexOf("// Odds-preview defense");
if (start < 0 || end < 0) throw new Error("combat block markers not found in game file");
const block = html.slice(start, end);
const client = new Function(`${block}\nreturn { TROOP_TYPES, effectiveAttack, effectiveDefense, roleProportions, troopCombatStats };`)();
const server = await import(pathToFileURL(path.join(root, "supabase/functions/_shared/game-math.ts")).href);

let fails = 0;
const check = (name, ok, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const randTroops = () => { const t = {}; client.TROOP_TYPES.forEach(x => { if (rnd() < 0.5) t[x.key] = { active: Math.floor(rnd() * 2000), wounded: 0 }; }); return t; };
const randForm = () => { const f = {}; client.TROOP_TYPES.forEach(x => { if (rnd() < 0.4) f[x.key] = Math.floor(rnd() * 1500); }); return f; };

let parityOk = true, worst = 0;
for (let i = 0; i < 500; i++) {
  const def = randTroops(), atk = randForm(), hm = 1 + rnd() * 6;
  const cp = client.roleProportions(def), sp = server.roleProportions(def);
  const ca = client.effectiveAttack(atk, cp, hm), sa = server.effectiveAttack(atk, sp, hm);
  const cd = client.effectiveDefense(def, atk), sd = server.effectiveDefense(def, atk);
  const cd0 = client.effectiveDefense(def), sd0 = server.effectiveDefense(def);
  for (const [c, s] of [[ca, sa], [cd, sd], [cd0, sd0]]) { if (!near(c, s)) parityOk = false; worst = Math.max(worst, Math.abs(c - s)); }
}
check("client and server attack/defense match on 500 random fights", parityOk, `worst diff ${worst}`);

const T = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { active: v, wounded: 0 }]));
const ratio = (atk, def) => server.effectiveAttack(atk, server.roleProportions(def), 1) / server.effectiveDefense(def, atk);

// Defender counter: enforcers counter archers, so they hold better vs archers than vs riders at equal strength
const vsArchers = server.effectiveDefense(T({ enforcer4: 1000 }), { gunner4: 1000 });
const vsRiders = server.effectiveDefense(T({ enforcer4: 1000 }), { driver4: 1000 });
check("defender counter bonus applies (enforcer defends better vs archers than vs riders)", vsArchers > vsRiders, `${vsArchers.toFixed(0)} vs ${vsRiders.toFixed(0)}`);

// Right formation vs wrong formation: same-size attacker, swing should be meaningful but bounded
const def = T({ enforcer4: 1000 });
const good = ratio({ driver4: 1000 }, def), bad = ratio({ gunner4: 1000 }, def);
check("formation swing is real (>1.4x) but bounded (<3x)", good / bad > 1.4 && good / bad < 3, `best/worst = ${(good / bad).toFixed(2)}x`);

// Iron Wall / Arrow Dodge must not take the Eagle Eye penalty (regression for the earlier bug)
const wall = server.effectiveDefense(T({ enforcer2: 100 }), { gunner1: 100 }), wallNoGun = server.effectiveDefense(T({ enforcer2: 100 }), { enforcer1: 100 });
check("Iron Wall untouched by enemy gunners (no Eagle Eye penalty)", wall >= wallNoGun * 0.999);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
