/**
 * Reply eval: reads every reply in evals/replies.cases.json against its open question with the
 * reply reader (lib/providers/replies.ts) and scores the kind and the choice. See evals/README.md.
 *
 *   npm run eval:replies                          hosted (Mistral), needs MISTRAL_API_KEY
 *   PROVIDER_MODE=local npm run eval:replies      Ollama on this computer
 *   npm run eval:replies -- --repeat 3            each case three times; flaky cases
 *   npm run eval:replies -- --tag tail,trap --lang uk --only u-dva,u-pershyi
 *   npm run eval:replies -- --save-baseline       write evals/baselines/replies-<model>.json
 *   npm run eval:replies -- --no-compare --no-save
 *
 * With a baseline for the model, the run is compared with it and exits 1 on a regression or a new
 * costly miss. Results go to evals/results/replies-<model>-<time>.jsonl unless --no-save.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { promptId } from "../lib/evals/extraction";
import {
  compareReplies,
  expectedKinds,
  scoreReply,
  summariseReplies,
  toReplyBaseline,
  type ReplyBaseline,
  type ReplyCasesFile,
  type ReplyResult,
  type Tally,
} from "../lib/evals/replies";
import { getReplyReader, REPLY_SCHEMA, replyPrompt } from "../lib/providers/replies";

const root = join(__dirname, "..");
if (existsSync(join(root, ".env.local"))) process.loadEnvFile(join(root, ".env.local"));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const casesFile = arg("cases") ?? "evals/replies.cases.json";
const file = JSON.parse(readFileSync(resolvePath(root, casesFile), "utf8")) as ReplyCasesFile;
const tags = list(arg("tag"));
const langs = list(arg("lang"));
const only = list(arg("only"));
const repeat = Math.max(1, Number(arg("repeat") ?? 1) || 1);
const save = !flag("no-save");
const saveBaseline = flag("save-baseline");
const filtered = tags.length > 0 || langs.length > 0 || only.length > 0;

const cases = file.cases.filter(
  (c) =>
    (!tags.length || c.tags.some((t) => tags.includes(t))) &&
    (!langs.length || langs.includes(file.questions[c.question].lang)) &&
    (!only.length || only.includes(c.id)),
);
if (!cases.length) {
  console.error("No case matches the filters.");
  process.exit(1);
}
if (saveBaseline && filtered) {
  console.error("A baseline is the whole corpus: drop --tag, --lang and --only to save one.");
  process.exit(1);
}

const PROMPT_ID = promptId([replyPrompt(), JSON.stringify(REPLY_SCHEMA)]);

/** Hosted Mistral answers 429 when calls come too fast; wait and try again, up to five times. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await call();
    } catch (err) {
      if (i >= 4 || !(err instanceof Error && / 429:/.test(err.message))) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}
const pct = (t?: Tally) => (t && t.total ? `${t.passed}/${t.total} (${Math.round((100 * t.passed) / t.total)}%)` : "-");
const COSTLY_MARK = { wrong_pick: "PICK!", wrong_subject: "SUBJ!", wrong_disregard: "DROP!" } as const;

async function main() {
  const reader = getReplyReader();
  const safeName = reader.name.replace(/[^\w.-]+/g, "_");
  console.log(`Reply eval · ${reader.name} · prompt ${PROMPT_ID} · ${cases.length} cases × ${repeat}`);

  const results: ReplyResult[] = [];
  for (let round = 1; round <= repeat; round++) {
    for (const c of cases) {
      const q = file.questions[c.question];
      let t0 = performance.now();
      let r: ReplyResult;
      try {
        const got = await withRetry(() => {
          t0 = performance.now(); // time the call that answered, not the waits
          return reader.read(c.reply, q, { timeoutMs: 60_000 });
        });
        const s = scoreReply(c, q, got);
        r = { id: c.id, round, kind: got.kind, choice: got.choice, pass: s.pass, costly: s.costly, ms: Math.round(performance.now() - t0) };
      } catch (err) {
        r = { id: c.id, round, kind: null, choice: null, pass: false, costly: null, ms: Math.round(performance.now() - t0), error: err instanceof Error ? err.message : String(err) };
      }
      results.push(r);
      if (!r.pass) {
        const want = `${expectedKinds(c).join("|")}${c.expect.choice != null ? ` ${c.expect.choice}` : ""}`;
        const got = r.error ? `error: ${r.error}` : `${r.kind}${r.choice != null ? ` ${r.choice}` : ""}`;
        console.log(`  ✗ ${r.costly ? `${COSTLY_MARK[r.costly]} ` : ""}${c.id} (round ${round}) ${JSON.stringify(c.reply)}: wanted ${want}, got ${got}`);
      }
    }
  }

  const s = summariseReplies(file, cases, results);
  console.log("");
  console.log(`Passed    ${pct(s.overall)}`);
  console.log(`Costly    ${s.costly.length} (PICK! wrong choice, SUBJ! wrong subject, DROP! withdrawn by mistake)`);
  if (repeat > 1) console.log(`Flaky     ${s.flaky.length ? s.flaky.join(", ") : "none"}`);
  if (s.errors) console.log(`Errors    ${s.errors}`);
  console.log(`Latency   median ${s.medianMs} ms, p90 ${s.p90Ms} ms`);
  console.log("");
  console.log("By tag:      " + ["fast", "tail", "trap"].map((t) => `${t} ${pct(s.byTag.get(t))}`).join(" · "));
  console.log("By language: " + ["en", "fr", "uk"].map((l) => `${l} ${pct(s.byLang.get(l))}`).join(" · "));
  console.log("By kind wanted (the first listed):");
  for (const [kind, t] of [...s.byKind].sort()) {
    const row = [...(s.confusion.get(kind) ?? new Map())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(`  ${kind.padEnd(11)} ${pct(t).padEnd(12)} said: ${row}`);
  }

  const run = toReplyBaseline({ reader: reader.name, prompt_id: PROMPT_ID, at: new Date().toISOString(), repeat }, results);
  const baselineFile = join(root, "evals/baselines", `replies-${safeName}.json`);
  if (!flag("no-compare") && existsSync(baselineFile)) {
    const base = JSON.parse(readFileSync(baselineFile, "utf8")) as ReplyBaseline;
    const d = compareReplies(base, run);
    console.log("");
    console.log(`Against the baseline (prompt ${base.prompt_id}, ${base.at.slice(0, 10)}):`);
    console.log(`  regressions ${d.regressions.length ? d.regressions.join(", ") : "none"}`);
    console.log(`  new costly misses ${d.newCostly.length ? d.newCostly.join(", ") : "none"}`);
    console.log(`  improvements ${d.improvements.length ? d.improvements.join(", ") : "none"}`);
    if (d.unseen.length) console.log(`  not in the baseline ${d.unseen.join(", ")}`);
    if (d.regressions.length || d.newCostly.length) process.exitCode = 1;
  }

  if (save) {
    const dir = join(root, "evals/results");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const out = join(dir, `replies-${safeName}-${stamp}.jsonl`);
    const header = { reader: reader.name, prompt_id: PROMPT_ID, repeat, filtered, passed: s.overall.passed, total: s.overall.total, costly: s.costly.length, median_ms: s.medianMs };
    writeFileSync(out, [header, ...results].map((x) => JSON.stringify(x)).join("\n") + "\n");
    console.log(`\nSaved ${out.slice(root.length + 1)}`);
  }
  if (saveBaseline) {
    mkdirSync(join(root, "evals/baselines"), { recursive: true });
    writeFileSync(baselineFile, JSON.stringify(run, null, 2) + "\n");
    console.log(`Baseline written: ${baselineFile.slice(root.length + 1)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
