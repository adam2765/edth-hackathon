/**
 * Intent-extraction eval: sends every case in evals/extraction.cases.json through the same
 * extractor the coordinator uses and scores the fields each case names.
 *
 *   npm run eval:extract                          hosted (Mistral), needs MISTRAL_API_KEY
 *   PROVIDER_MODE=local npm run eval:extract      Ollama on this computer
 *   npm run eval:extract -- --area kyiv --tag track --only s-k1,s-k2 --repeat 3 --no-save
 *
 * Results go to evals/results/<model>-<time>.jsonl unless --no-save.
 * The language is not pinned, so the model's label (checked against the letters) is scored.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AREAS } from "../lib/geo/areas";
import { getExtractor, systemPrompt } from "../lib/providers/extractor";
import { inPrompt, scoreCase, summarise, type CaseResult, type EvalCase, type Tally } from "../lib/evals/extraction";

const root = join(__dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const all = (JSON.parse(readFileSync(join(root, "evals/extraction.cases.json"), "utf8")) as { cases: EvalCase[] }).cases;
const areas = list(arg("area"));
const tags = list(arg("tag"));
const only = list(arg("only"));
const repeat = Math.max(1, Number(arg("repeat") ?? 1) || 1);
const save = !process.argv.includes("--no-save");

const cases = all.filter(
  (c) => (!areas.length || areas.includes(c.area)) && (!tags.length || c.tags.some((t) => tags.includes(t))) && (!only.length || only.includes(c.id)),
);
if (!cases.length) {
  console.error("No case matches the filters.");
  process.exit(1);
}

const pct = (t: Tally) => (t.total ? `${t.passed}/${t.total} (${Math.round((100 * t.passed) / t.total)}%)` : "-");
const show = (v: unknown) => JSON.stringify(v);

async function main() {
  const extractor = getExtractor();
  console.log(`${extractor.name}: ${cases.length} cases${repeat > 1 ? ` × ${repeat}` : ""}\n`);
  const results: CaseResult[] = [];
  const rows: object[] = [];

  for (let round = 0; round < repeat; round++) {
    for (const c of cases) {
      const place = AREAS[c.area].place;
      const t0 = performance.now();
      let r: CaseResult;
      let intent: unknown = null;
      try {
        const got = await extractor.extract(c.text, { place });
        intent = got;
        r = { id: c.id, tags: c.tags, inPrompt: inPrompt(c.text, systemPrompt(place)), misses: scoreCase(c, got), ms: Math.round(performance.now() - t0) };
      } catch (err) {
        r = { id: c.id, tags: c.tags, inPrompt: inPrompt(c.text, systemPrompt(place)), misses: [], error: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - t0) };
      }
      results.push(r);
      rows.push({ round, ...r, text: c.text, intent });
      const mark = r.error ? "ERR " : r.misses.length ? "FAIL" : "ok  ";
      console.log(`${mark} ${c.id.padEnd(16)} ${String(r.ms).padStart(5)} ms  ${c.text}${r.inPrompt ? "  [in prompt]" : ""}`);
      if (r.error) console.log(`       ${r.error}`);
      for (const m of r.misses) console.log(`       ${m.field}: want ${show(m.want)}, got ${show(m.got)}`);
    }
  }

  const s = summarise(cases, results);
  console.log(`\nCases     ${pct(s.cases)}   held out ${pct(s.heldOut)}   in prompt ${pct(s.inPrompt)}`);
  console.log(`Latency   median ${s.medianMs} ms, p90 ${s.p90Ms} ms`);
  console.log("\nBy field");
  for (const [k, t] of Object.entries(s.fields).sort((a, b) => a[1].passed / a[1].total - b[1].passed / b[1].total)) console.log(`  ${k.padEnd(20)} ${pct(t)}`);
  console.log("\nBy tag");
  for (const [k, t] of Object.entries(s.tags).sort()) console.log(`  ${k.padEnd(20)} ${pct(t)}`);

  if (save) {
    const dir = join(root, "evals/results");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = join(dir, `${extractor.name.replace(/[^\w.-]+/g, "_")}-${stamp}.jsonl`);
    const header = { extractor: extractor.name, at: new Date().toISOString(), repeat, filters: { areas, tags, only }, summary: s };
    writeFileSync(file, [header, ...rows].map((o) => JSON.stringify(o)).join("\n") + "\n");
    console.log(`\nSaved ${file.slice(root.length + 1)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
