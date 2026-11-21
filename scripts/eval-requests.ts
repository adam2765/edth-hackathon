/**
 * Scores the request reader on evals/requests.cases.json [234]. No model, no network.
 *
 *   npm run eval:requests                  every case; prints the misses and a summary
 *   npm run eval:requests -- --all         print every case, passed or not
 *   npm run eval:requests -- --tag uk      cases with any of these tags
 *   npm run eval:requests -- <file.json>   another cases file
 *
 * Exits 1 when a case misses. A request read where none was said is marked CUT!: its words would be
 * cut out of the report, and a request nobody made would wait at the command post.
 */
import { resolve } from "node:path";
import { loadRequestEval, REQUEST_CASES, scoreRequestCase, type RequestScore } from "../lib/evals/requests";

const args = process.argv.slice(2);
const file = resolve(args.find((a) => a.endsWith(".json")) ?? REQUEST_CASES);
const tagArg = args.includes("--tag") ? args[args.indexOf("--tag") + 1].split(",") : null;
const all = args.includes("--all");

const doc = loadRequestEval(file);
const cases = doc.cases.filter((c) => !tagArg || (c.tags ?? []).some((t) => tagArg.includes(t)));
const scores: RequestScore[] = cases.map((c) => scoreRequestCase(c));

const show = (s: RequestScore) => {
  const r = s.got.request;
  if (!r) return "no request";
  return `request "${r.words}"${r.n != null ? `, Track ${r.n}` : ""}${s.got.only ? ", on its own" : `, left "${s.got.text}"`}`;
};

cases.forEach((c, k) => {
  const s = scores[k];
  if (s.pass && !all) return;
  const mark = s.pass ? "ok   " : s.falseRequest ? "CUT! " : "miss ";
  console.log(`${mark} ${c.id.padEnd(16)} ${JSON.stringify(c.text)}`);
  console.log(`      ${show(s)}`);
  if (!s.pass) console.log(`      ${s.misses.join("; ")}`);
});

const passed = scores.filter((s) => s.pass).length;
const cut = scores.filter((s) => s.falseRequest).length;
console.log(`\n${passed} of ${scores.length} cases passed. Requests read where none was said: ${cut}.`);

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

const want = (r: boolean) => cases.filter((c) => c.expect.request === r).length;
const got = (r: boolean) => scores.filter((s, i) => s.pass && cases[i].expect.request === r).length;
console.log(`\nBy answer wanted: request ${got(true)}/${want(true)}, none ${got(false)}/${want(false)}`);
if (passed < scores.length) process.exitCode = 1;
