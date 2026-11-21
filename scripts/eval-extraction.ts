/**
 * Intent-extraction eval: sends every case in evals/extraction.cases.json through the same
 * extractor the coordinator uses and scores the fields each case names. See evals/README.md.
 *
 *   npm run eval:extract                          hosted (Mistral), needs MISTRAL_API_KEY
 *   PROVIDER_MODE=local npm run eval:extract      Ollama on this computer
 *   npm run eval:extract -- --area kyiv --tag track --only s-k1,s-k2
 *   npm run eval:extract -- --repeat 3            each case three times; flaky cases and fields
 *   npm run eval:extract -- --resolve             also run the resolver and score outcomes, wrong pins
 *   npm run eval:extract -- --save-baseline       write evals/baselines/<model>.json from this run
 *   npm run eval:extract -- --no-compare --no-save
 *   npm run eval:extract -- --cases /path/to/new.cases.json   another cases file (an attack's draft)
 *
 * With a baseline for the model, the run is compared with it and exits 1 on a regression or a
 * new wrong pin. Results go to evals/results/<model>-<time>.jsonl unless --no-save.
 * The language is not pinned, so the model's label (checked against the letters) is scored.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { AREAS } from "../lib/geo/areas";
import type { Intent, Resolution } from "../lib/geo/types";
import { resolveCase } from "../lib/evals/resolve";
import { getExtractor, INTENT_SCHEMA, systemPrompt } from "../lib/providers/extractor";
import {
  compare,
  fieldValue,
  inPrompt,
  promptId,
  SCORED_FIELDS,
  scoreCase,
  scoreOutcome,
  summarise,
  toBaseline,
  verdicts,
  type Baseline,
  type CaseResult,
  type EvalCase,
  type Tally,
} from "../lib/evals/extraction";

const root = join(__dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const casesFile = arg("cases") ?? "evals/extraction.cases.json";
const all = (JSON.parse(readFileSync(resolvePath(root, casesFile), "utf8")) as { cases: EvalCase[] }).cases;
const areas = list(arg("area"));
const tags = list(arg("tag"));
const only = list(arg("only"));
const repeat = Math.max(1, Number(arg("repeat") ?? 1) || 1);
const withResolve = flag("resolve");
const save = !flag("no-save");
const saveBaseline = flag("save-baseline");
const filtered = areas.length > 0 || tags.length > 0 || only.length > 0;

const cases = all.filter(
  (c) => (!areas.length || areas.includes(c.area)) && (!tags.length || c.tags.some((t) => tags.includes(t))) && (!only.length || only.includes(c.id)),
);
if (!cases.length) {
  console.error("No case matches the filters.");
  process.exit(1);
}
if (saveBaseline && filtered) {
  console.error("A baseline is the whole corpus: drop --area, --tag and --only to save one.");
  process.exit(1);
}

const pct = (t: Tally) => (t.total ? `${t.passed}/${t.total} (${Math.round((100 * t.passed) / t.total)}%)` : "-");
const show = (v: unknown) => JSON.stringify(v);
const NOW = Date.now();

/** The prompt for every area and the schema: changing any of them changes the id. */
const PROMPT_ID = promptId([...Object.values(AREAS).map((a) => systemPrompt(a.place)), JSON.stringify(INTENT_SCHEMA)]);

async function main() {
  const extractor = getExtractor();
  const safeName = extractor.name.replace(/[^\w.-]+/g, "_");
  console.log(`${extractor.name}, prompt ${PROMPT_ID}: ${cases.length} cases${repeat > 1 ? ` × ${repeat}` : ""}${withResolve ? ", with the resolver" : ""}\n`);
  const results: CaseResult[] = [];
  const rows: object[] = [];

  for (let round = 0; round < repeat; round++) {
    if (repeat > 1) console.log(`Round ${round + 1}`);
    for (const c of cases) {
      const place = AREAS[c.area].place;
      const base = { id: c.id, round, tags: c.tags, inPrompt: inPrompt(c.text, systemPrompt(place)) };
      const t0 = performance.now();
      let r: CaseResult;
      let intent: Intent | null = null;
      let resolution: Resolution | null = null;
      try {
        intent = await extractor.extract(c.text, { place });
        const ms = Math.round(performance.now() - t0);
        const values = Object.fromEntries(SCORED_FIELDS.filter((f) => f in c.expect).map((f) => [f, fieldValue(intent!, f)]));
        r = { ...base, misses: scoreCase(c, intent), values, ms };
        if (withResolve && c.outcome) {
          resolution = resolveCase(c, intent, NOW);
          r.outcome = scoreOutcome(c, resolution) ?? undefined;
        }
      } catch (err) {
        r = { ...base, misses: [], values: {}, error: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - t0) };
      }
      results.push(r);
      rows.push({ ...r, text: c.text, intent, resolution: resolution && { status: resolution.status, rule: resolution.evidence.rule, feature_id: resolution.evidence.feature_id, heading_to: resolution.heading_to?.id, question: resolution.question } });
      const bad = r.error || r.misses.length || r.outcome?.misses.length;
      const mark = r.error ? "ERR " : r.outcome?.wrongPin ? "PIN!" : bad ? "FAIL" : "ok  ";
      console.log(`${mark} ${c.id.padEnd(18)} ${String(r.ms).padStart(5)} ms  ${c.text}${r.inPrompt ? "  [in prompt]" : ""}`);
      if (r.error) console.log(`       ${r.error}`);
      for (const m of r.misses) console.log(`       ${m.field}: want ${show(m.want)}, got ${show(m.got)}`);
      for (const m of r.outcome?.misses ?? []) console.log(`       outcome ${m.what}: want ${show(m.want)}, got ${show(m.got)}`);
    }
  }

  const s = summarise(cases, results);
  const vs = verdicts(results);
  console.log(`\nCases     ${pct(s.cases)}   held out ${pct(s.heldOut)}   in prompt ${pct(s.inPrompt)}`);
  if (withResolve) console.log(`Outcomes  ${pct(s.outcomes)}   wrong pins ${s.wrongPins}`);
  if (repeat > 1) {
    console.log(`Flaky     ${s.flaky} of ${vs.length} cases`);
    for (const v of vs.filter((v) => v.flaky || v.flips.length)) console.log(`  ${v.id.padEnd(18)} passed ${v.passes}/${v.rounds}${v.flips.length ? `, changes: ${v.flips.join(", ")}` : ""}`);
  }
  console.log(`Latency   median ${s.medianMs} ms, p90 ${s.p90Ms} ms`);
  console.log("\nBy field");
  for (const [k, t] of Object.entries(s.fields).sort((a, b) => a[1].passed / a[1].total - b[1].passed / b[1].total)) console.log(`  ${k.padEnd(20)} ${pct(t)}`);
  console.log("\nBy tag");
  for (const [k, t] of Object.entries(s.tags).sort()) console.log(`  ${k.padEnd(20)} ${pct(t)}`);

  const run = toBaseline({ extractor: extractor.name, prompt_id: PROMPT_ID, at: new Date().toISOString(), repeat, resolve: withResolve }, cases, results);
  let failed = false;
  const baselineFile = join(root, "evals/baselines", `${safeName}.json`);
  if (!flag("no-compare") && existsSync(baselineFile)) {
    const base = JSON.parse(readFileSync(baselineFile, "utf8")) as Baseline;
    const d = compare(base, run);
    console.log(`\nAgainst the baseline (prompt ${base.prompt_id}, ${base.at.slice(0, 10)}, ${base.cases ? Object.keys(base.cases).length : 0} cases${base.repeat > 1 ? ` × ${base.repeat}` : ""}${base.resolve ? ", resolved" : ""})`);
    console.log(`  regressions   ${d.regressions.join(", ") || "none"}`);
    console.log(`  new wrong pins ${d.newWrongPins.join(", ") || "none"}`);
    console.log(`  improvements  ${d.improvements.join(", ") || "none"}`);
    console.log(`  still failing ${d.stillFailing.length}`);
    if (d.added.length) console.log(`  not in baseline ${d.added.join(", ")}`);
    if (withResolve && !base.resolve) console.log("  The baseline did not run the resolver, so wrong pins are not compared.");
    failed = d.regressions.length > 0 || (base.resolve && d.newWrongPins.length > 0);
  }

  if (save) {
    const dir = join(root, "evals/results");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = join(dir, `${safeName}-${stamp}.jsonl`);
    const header = { extractor: extractor.name, prompt_id: PROMPT_ID, at: run.at, repeat, resolve: withResolve, filters: { areas, tags, only }, summary: s };
    writeFileSync(file, [header, ...rows].map((o) => JSON.stringify(o)).join("\n") + "\n");
    console.log(`\nSaved ${file.slice(root.length + 1)}`);
  }
  if (saveBaseline) {
    mkdirSync(join(root, "evals/baselines"), { recursive: true });
    writeFileSync(baselineFile, JSON.stringify(run, null, 2) + "\n");
    console.log(`Baseline written: ${baselineFile.slice(root.length + 1)}`);
  }
  if (failed) {
    console.log("\nWorse than the baseline: see the regressions above.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
