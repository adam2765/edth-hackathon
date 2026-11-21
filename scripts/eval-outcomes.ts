/**
 * Fills in each case's expected outcome: what the resolver answers for a right reading (the
 * case's own expected fields). No model is called. Then `--resolve` can count wrong pins.
 *
 *   npm run eval:outcomes                 add an outcome to cases that have none
 *   npm run eval:outcomes -- --check      list cases whose outcome no longer matches the resolver
 *   npm run eval:outcomes -- --refresh    rewrite every derived outcome (after a resolver change)
 *
 * Cases tagged `scenario` keep the outcome copied from their scenario file and are only checked.
 * A derived outcome is marked "outcome_from": "resolver", so --refresh knows it may rewrite it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { EvalCase, ExpectedOutcome } from "../lib/evals/extraction";
import { expectedIntent, outcomeOf, resolveCase } from "../lib/evals/resolve";

type Case = EvalCase & { outcome_from?: "resolver" };
const root = join(__dirname, "..");
const file = resolve(root, process.argv.find((a) => a.endsWith(".json")) ?? "evals/extraction.cases.json");
const doc = JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] };
const check = process.argv.includes("--check");
const refresh = process.argv.includes("--refresh");
const now = Date.now();
const same = (a?: ExpectedOutcome, b?: ExpectedOutcome) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

let added = 0;
let changed = 0;
const drift: string[] = [];
for (const c of doc.cases) {
  const derived = outcomeOf(resolveCase(c, expectedIntent(c), now));
  if (!c.outcome) {
    if (check) drift.push(`${c.id}: no outcome`);
    else {
      c.outcome = derived;
      c.outcome_from = "resolver";
      added++;
    }
    continue;
  }
  // A scenario outcome may allow more than the resolver gives (any of several ids); check it holds.
  const holds = c.outcome_from === "resolver" ? same(c.outcome, derived) : outcomeHolds(c.outcome, derived);
  if (holds) continue;
  if (refresh && c.outcome_from === "resolver") {
    c.outcome = derived;
    changed++;
  } else drift.push(`${c.id}: case says ${JSON.stringify(c.outcome)}, a right reading now gives ${JSON.stringify(derived)}`);
}

function outcomeHolds(want: ExpectedOutcome, got: ExpectedOutcome): boolean {
  // Any question holds against a case that wants a question; the kind of question is not compared.
  const asks = (o: ExpectedOutcome) => !!o.status && ![o.status].flat().includes("resolved");
  if (asks(got)) return !want.status || [want.status].flat().some((st) => st !== "resolved");
  if (want.status && ![want.status].flat().includes("resolved")) return false;
  const ok = (w: string | string[] | undefined, g: string | string[] | undefined) => !w || (typeof g === "string" && [w].flat().includes(g));
  return ok(want.feature_id, got.feature_id) && ok(want.heading_to, got.heading_to);
}

if (!check && (added || changed)) {
  writeFileSync(file, JSON.stringify(doc, null, 2));
  execFileSync("npx", ["tsx", join(root, "scripts/eval-format.ts"), relative(root, file)], { stdio: "inherit" });
}
console.log(`${added} outcomes added, ${changed} refreshed.`);
if (drift.length) {
  console.log(`\n${drift.length} cases where the outcome and a right reading disagree. Either the resolver changed (run with --refresh for derived outcomes) or the case is wrong:`);
  for (const d of drift) console.log(`  ${d}`);
  process.exitCode = 1;
}
