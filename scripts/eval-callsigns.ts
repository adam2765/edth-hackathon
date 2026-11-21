/**
 * Scores the call-sign reader on evals/callsigns.cases.json [200]. No model, no network.
 *
 *   npm run eval:callsigns                  every case; prints the misses and a summary
 *   npm run eval:callsigns -- --all         print every case, passed or not
 *   npm run eval:callsigns -- --tag uk      cases with any of these tags
 *   npm run eval:callsigns -- <file.json>   another cases file
 *
 * Exits 1 when a case misses. A wrong unit (a unit named where the case wants a question, no unit
 * or another unit) is marked UNIT!: that unit would move on the map.
 */
import { resolve } from "node:path";
import { CALLSIGN_CASES, loadCallsignEval, scoreCallsignCase, type CallsignScore } from "../lib/evals/callsigns";

const args = process.argv.slice(2);
const file = resolve(args.find((a) => a.endsWith(".json")) ?? CALLSIGN_CASES);
const tagArg = args.includes("--tag") ? args[args.indexOf("--tag") + 1].split(",") : null;
const all = args.includes("--all");

const doc = loadCallsignEval(file);
const cases = doc.cases.filter((c) => !tagArg || (c.tags ?? []).some((t) => tagArg.includes(t)));
const scores: CallsignScore[] = cases.map((c) => scoreCallsignCase(c, doc.roster));

const show = (s: CallsignScore) => {
  const g = s.got;
  const said = g.kind === "unit" ? `unit ${g.callsign} (${g.how})` : g.kind === "ask" ? `ask ${g.candidates.join(" / ")}` : `unassigned${g.read ? ` (read ${g.read})` : ""}`;
  return `${said}: ${g.why}`;
};

console.log(`Roster: ${doc.roster.join(", ")}\n`);
cases.forEach((c, k) => {
  const s = scores[k];
  if (s.pass && !all) return;
  const mark = s.pass ? "ok   " : s.wrongUnit ? "UNIT!" : "miss ";
  console.log(`${mark} ${c.id.padEnd(20)} ${JSON.stringify(c.text)}`);
  console.log(`      ${show(s)}`);
  if (!s.pass) console.log(`      ${s.misses.join("; ")}`);
});

const passed = scores.filter((s) => s.pass).length;
const wrong = scores.filter((s) => s.wrongUnit).length;
console.log(`\n${passed} of ${scores.length} cases passed. Wrong units: ${wrong}.`);

const byTag = new Map<string, { n: number; ok: number }>();
cases.forEach((c, k) => {
  for (const t of c.tags ?? []) {
    const b = byTag.get(t) ?? { n: 0, ok: 0 };
    b.n++;
    if (scores[k].pass) b.ok++;
    byTag.set(t, b);
  }
});
console.log("\nBy tag:");
for (const [t, b] of [...byTag].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${t.padEnd(14)} ${b.ok}/${b.n}`);

const want = (k: string) => cases.filter((c) => c.expect.kind === k).length;
const got = (k: string) => scores.filter((s, i) => s.pass && cases[i].expect.kind === k).length;
console.log(`\nBy answer wanted: unit ${got("unit")}/${want("unit")}, ask ${got("ask")}/${want("ask")}, unassigned ${got("unassigned")}/${want("unassigned")}`);
if (passed < scores.length) process.exitCode = 1;
