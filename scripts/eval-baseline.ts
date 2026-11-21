/**
 * Writes evals/baselines/<model>.json from a run already saved in evals/results/, so an accepted
 * change needs no second run. The run must cover the whole corpus (no filters) and its prompt id
 * must be the current prompt's.
 *
 *   npm run eval:baseline -- evals/results/<model>-<time>.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { AREAS } from "../lib/geo/areas";
import { INTENT_SCHEMA, systemPrompt } from "../lib/providers/extractor";
import { promptId, toBaseline, type CaseResult, type EvalCase } from "../lib/evals/extraction";

const root = join(__dirname, "..");
const arg = process.argv[2];
if (!arg) {
  console.error("Give a results file: npm run eval:baseline -- evals/results/<model>-<time>.jsonl");
  process.exit(1);
}
const file = resolve(root, arg);
const [head, ...rows] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const { extractor, prompt_id, at, repeat, resolve: resolved, filters } = head as {
  extractor: string; prompt_id?: string; at: string; repeat: number; resolve?: boolean;
  filters: { areas: string[]; tags: string[]; only: string[] };
};
const current = promptId([...Object.values(AREAS).map((a) => systemPrompt(a.place)), JSON.stringify(INTENT_SCHEMA)]);
const cases = (JSON.parse(readFileSync(join(root, "evals/extraction.cases.json"), "utf8")) as { cases: EvalCase[] }).cases;

const problems: string[] = [];
if (prompt_id !== current) problems.push(`the run scored prompt ${prompt_id ?? "(none)"}, the current prompt is ${current}`);
if (filters.areas.length || filters.tags.length || filters.only.length) problems.push("the run used filters; a baseline is the whole corpus");
const ran = new Set(rows.map((r: CaseResult) => r.id));
const missing = cases.filter((c) => !ran.has(c.id)).map((c) => c.id);
if (missing.length) problems.push(`the run has no result for ${missing.join(", ")}`);
if (problems.length) {
  console.error(`Not a baseline: ${problems.join("; ")}.`);
  process.exit(1);
}

const results = rows.map((r: CaseResult) => ({ id: r.id, round: r.round, tags: r.tags, inPrompt: r.inPrompt, misses: r.misses, values: r.values, outcome: r.outcome, error: r.error, ms: r.ms }));
const base = toBaseline({ extractor, prompt_id: current, at, repeat, resolve: !!resolved }, cases, results);
const out = join(root, "evals/baselines", `${extractor.replace(/[^\w.-]+/g, "_")}.json`);
writeFileSync(out, JSON.stringify(base, null, 2) + "\n");
console.log(`Baseline written: evals/baselines/${basename(out)} (prompt ${current}, ${cases.length} cases × ${repeat}, from ${basename(file)})`);
