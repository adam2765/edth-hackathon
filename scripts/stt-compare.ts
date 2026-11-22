/**
 * Compares speech-to-text options on the scenario clips (docs/stt-comparison.md). Measures only:
 * nothing in the app changes. Each command writes one JSON line per clip.
 *
 *   npx tsx scripts/stt-compare.ts whisper <ggml-model.bin> <out.jsonl> [--no-hints]
 *   npx tsx scripts/stt-compare.ts parakeet <parakeet-cli> <ggml-parakeet.bin> <out.jsonl>
 *   npx tsx scripts/stt-compare.ts coordinator <out.jsonl> [--no-bias]     (MISTRAL_API_KEY, or PROVIDER_MODE=local and npm run stt)
 *   REPORT_STORE_DIR=<dir> npx tsx scripts/stt-compare.ts score <out.jsonl> <label>=<transcripts.jsonl | script> ...
 *
 * whisper: whisper.cpp's `whisper-cli` on this computer stands in for whisper.rn on the phone, with
 *   what the transmitter passes (transmitter/src/stt.ts): the step's language pinned (decision 106),
 *   the area's hint names as the prompt (decision 73), 4 threads, greedy decoding.
 * parakeet: whisper.cpp's `parakeet-cli`; it takes no language and no prompt.
 * coordinator (was voxtral): the coordinator's own transcriber, as `POST /api/report` calls it, with
 *   the step's language: Voxtral with 100 bias terms in hosted mode, whisper-server in offline mode.
 * score: runs each scenario as the transmitter does (transmitter/App.tsx): a fresh mission, steps in
 *   order, the transcript sent as `text` with the step's language, and a question answered with the
 *   step's `choose`. `script` sends the scenario's own words: the ceiling. Uses hosted mode unless
 *   PROVIDER_MODE=local. Point REPORT_STORE_DIR at a scratch folder so the missions stay out of .data/.
 *
 * SCENARIOS_DIR and CLIPS_DIR (default scenarios/ and transmitter/scenarios/audio/) let real clips
 * be measured the same way: a scenario file with expected answers and a folder of
 * <scenario>/<step>.wav (and .m4a), both kept out of git.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AreaId } from "../lib/geo/areas";
import type { Resolution } from "../lib/geo/types";

type Lang = "en" | "fr" | "uk";
interface Step {
  id: string;
  callsign: string;
  lang: Lang;
  text: string;
  expect: {
    status: Resolution["status"];
    feature_id?: string;
    heading_to?: string;
    track?: { n?: number; affiliation?: string | null; kind?: string };
  };
  choose?: string;
}
interface Scenario {
  id: string;
  area: AreaId;
  steps: Step[];
}
interface Heard {
  scenario: string;
  step: string;
  lang: Lang;
  said: string;
  heard: string;
  /** Speech-to-text time for this clip, without loading the model. */
  ms_stt: number;
}

const root = join(__dirname, "..");
const scenariosDir = resolve(root, process.env.SCENARIOS_DIR ?? "scenarios");
const clipsDir = resolve(root, process.env.CLIPS_DIR ?? "transmitter/scenarios/audio");
/** A step's uncompressed clip: <step>-pcm.wav in the repo (build-scenarios.mjs), <step>.wav in a folder of real clips. */
function wavClip(scenario: string, step: string): string {
  const pcm = join(clipsDir, scenario, `${step}-pcm.wav`);
  return existsSync(pcm) ? pcm : join(clipsDir, scenario, `${step}.wav`);
}

function scenarios(): Scenario[] {
  return readdirSync(scenariosDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(scenariosDir, f), "utf8")) as Scenario);
}

function writeLines(file: string, rows: object[]) {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** whisper.cpp prints "<name> time = 123.45 ms"; the clip's own time is the total less the load. */
function cppTime(stderr: string, prefix: string): number {
  const t = (name: string) => Number(new RegExp(`${prefix}_print_timings:\\s+${name} time =\\s+([\\d.]+) ms`).exec(stderr)?.[1] ?? 0);
  return Math.round(t("total") - t("load"));
}

function eachClip(fn: (sc: Scenario, step: Step) => Omit<Heard, "scenario" | "step" | "lang" | "said">): Heard[] {
  const rows: Heard[] = [];
  for (const sc of scenarios()) {
    for (const step of sc.steps) {
      const row = { scenario: sc.id, step: step.id, lang: step.lang, said: step.text, ...fn(sc, step) };
      console.log(`${sc.id}/${step.id} ${row.ms_stt} ms  ${step.text} -> ${row.heard}`);
      rows.push(row);
    }
  }
  return rows;
}

function whisper(model: string, out: string, hints: boolean) {
  const names = JSON.parse(readFileSync(join(root, "transmitter/src/hints.generated.json"), "utf8")) as Record<string, string[]>;
  const tmp = mkdtempSync(join(tmpdir(), "stt-whisper-"));
  writeLines(
    out,
    eachClip((sc, step) => {
      const of = join(tmp, `${sc.id}-${step.id}`);
      const args = ["-m", model, "-f", wavClip(sc.id, step.id), "-l", step.lang, "-bs", "1", "-t", "4", "-oj", "-of", of];
      if (hints) args.push("--prompt", names[sc.area].join(", "));
      const p = spawnSync("whisper-cli", args, { encoding: "utf8" });
      const json = existsSync(`${of}.json`) ? (JSON.parse(readFileSync(`${of}.json`, "utf8")) as { transcription: { text: string }[] }) : null;
      const heard = json ? json.transcription.map((s) => s.text.trim()).join(" ").trim() : "";
      return { heard, ms_stt: cppTime(p.stderr, "whisper") };
    }),
  );
}

function parakeet(cli: string, model: string, out: string) {
  const tmp = mkdtempSync(join(tmpdir(), "stt-parakeet-"));
  writeLines(
    out,
    eachClip((sc, step) => {
      const of = join(tmp, `${sc.id}-${step.id}`);
      const p = spawnSync(cli, ["-m", model, "-f", wavClip(sc.id, step.id), "-t", "4", "-otxt", "-of", of], { encoding: "utf8" });
      const heard = existsSync(`${of}.txt`) ? readFileSync(`${of}.txt`, "utf8").trim() : "";
      return { heard, ms_stt: cppTime(p.stderr, "parakeet") };
    }),
  );
}

async function coordinator(out: string, bias: boolean) {
  const { getTranscriber } = await import("../lib/providers/transcriber");
  const { biasTerms, loadGazetteer } = await import("../lib/geo/gazetteer");
  const t = getTranscriber();
  const rows: Heard[] = [];
  for (const sc of scenarios()) {
    const terms = bias ? biasTerms(loadGazetteer(sc.area), 100) : [];
    for (const step of sc.steps) {
      const m4a = join(clipsDir, sc.id, `${step.id}.m4a`);
      const file = existsSync(m4a) ? m4a : wavClip(sc.id, step.id);
      const mime = file.endsWith(".m4a") ? "audio/mp4" : "audio/wav";
      const s = performance.now();
      const r = await t.transcribe(new Blob([readFileSync(file)], { type: mime }), mime, terms, { language: step.lang });
      const row = { scenario: sc.id, step: step.id, lang: step.lang, said: step.text, heard: r.text, ms_stt: Math.round(performance.now() - s) };
      console.log(`${sc.id}/${step.id} ${row.ms_stt} ms  ${step.text} -> ${row.heard}`);
      rows.push(row);
    }
  }
  writeLines(out, rows);
}

/** The transmitter's own check (transmitter/App.tsx `evaluate`), on the coordinator's reply. */
function evaluate(step: Step, r: Resolution, chosen: boolean): { pass: boolean; note: string } {
  if (r.status !== step.expect.status) return { pass: false, note: `expected ${step.expect.status}, got ${r.status}` };
  if (step.expect.feature_id && r.evidence.feature_id !== step.expect.feature_id) return { pass: false, note: `expected ${step.expect.feature_id}, got ${r.evidence.feature_id ?? "none"}` };
  if (step.expect.heading_to && r.heading_to?.id !== step.expect.heading_to) return { pass: false, note: `expected heading to ${step.expect.heading_to}, got ${r.heading_to?.id ?? "none"}` };
  const want = step.expect.track;
  if (want && !r.track) return { pass: false, note: "expected a report about a track, got one about the speaker" };
  if (!want && r.track && r.status !== "unresolved") return { pass: false, note: "read as a report about a track" };
  if (want && r.track) {
    if (want.n !== undefined && r.track.n !== want.n) return { pass: false, note: `expected Track ${want.n}, got ${r.track.n ?? "none"}` };
    if (want.affiliation !== undefined && r.track.affiliation !== want.affiliation) return { pass: false, note: `expected ${want.affiliation}, got ${r.track.affiliation ?? "none"}` };
    if (want.kind !== undefined && r.track.kind !== want.kind) return { pass: false, note: `expected ${want.kind}, got ${r.track.kind ?? "none"}` };
  }
  if (step.choose && !chosen) return { pass: false, note: `choice ${step.choose} was not offered` };
  return { pass: true, note: chosen ? "asked, chose the step's choice" : r.status };
}

async function score(out: string, specs: string[]) {
  const report = await import("../app/api/report/route");
  const sessions = await import("../app/api/sessions/route");
  const answer = await import("../app/api/answer/route");
  const rows: object[] = [];
  let n = 0;
  for (const spec of specs) {
    const [label, file] = spec.split("=");
    const heard = new Map<string, Heard>();
    if (file !== "script") {
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        const h = JSON.parse(line) as Heard;
        heard.set(`${h.scenario}/${h.step}`, h);
      }
    }
    let passed = 0;
    let total = 0;
    for (const sc of scenarios()) {
      const opened = await sessions.POST(new Request("http://local/api/sessions", { method: "POST", body: JSON.stringify({ area: sc.area, name: `stt ${label} ${sc.id}` }) }));
      const { mission } = (await opened.json()) as { mission: { code: string } };
      let seq = 0;
      for (const step of sc.steps) {
        const h = file === "script" ? undefined : heard.get(`${sc.id}/${step.id}`);
        const text = (file === "script" ? step.text : (h?.heard ?? "")).trim();
        const base = { candidate: label, scenario: sc.id, step: step.id, lang: step.lang, said: step.text, heard: text, ms_stt: h?.ms_stt ?? null };
        total++;
        if (!text) {
          rows.push({ ...base, pass: false, note: "heard nothing" });
          continue;
        }
        const form = new FormData();
        for (const [k, v] of Object.entries({ text, area: sc.area, language: step.lang, clientTs: String(Date.now()), session: mission.code, callsign: step.callsign, seq: String(++seq) })) form.append(k, v);
        let reply: { error?: string; report_id?: string; resolution?: Resolution } = {};
        // A rate limit from Mistral comes back as an error; wait and send the same report again.
        for (let attempt = 0; attempt < 4; attempt++) {
          n++;
          const res = await report.POST(new Request("http://local/api/report", { method: "POST", body: form, headers: { "x-forwarded-for": `10.0.${n >> 8}.${n & 255}` } }));
          reply = await res.json();
          if (!reply.error) break;
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
        if (!reply.resolution) {
          rows.push({ ...base, pass: false, note: `error: ${reply.error}` });
          continue;
        }
        const r = reply.resolution;
        const chosen = r.status === "ambiguous" && !!step.choose && r.candidates.some((c) => c.id === step.choose);
        if (chosen && reply.report_id) {
          await answer.POST(new Request("http://local/api/answer", { method: "POST", body: JSON.stringify({ session: mission.code, report: reply.report_id, choice: step.choose }) }));
        }
        const v = evaluate(step, r, chosen);
        if (v.pass) passed++;
        rows.push({ ...base, pass: v.pass, note: v.note, status: r.status, feature: r.evidence.feature_id ?? null });
        console.log(`${label} ${sc.id}/${step.id} ${v.pass ? "pass" : "FAIL"} ${v.note}`);
      }
    }
    console.log(`${label}: ${passed} of ${total} as expected`);
  }
  writeLines(out, rows);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const pos = args.filter((a) => !a.startsWith("--"));
  // whisper-cli must be on the PATH (Homebrew: brew install whisper-cpp).
  if (cmd === "whisper" && pos.length === 2) whisper(pos[0], pos[1], !flags.has("--no-hints"));
  else if (cmd === "parakeet" && pos.length === 3) parakeet(pos[0], pos[1], pos[2]);
  else if ((cmd === "coordinator" || cmd === "voxtral") && pos.length === 1) await coordinator(pos[0], !flags.has("--no-bias"));
  else if (cmd === "score" && pos.length >= 2) await score(pos[0], pos.slice(1));
  else {
    console.error(readFileSync(__filename, "utf8").split("*/")[0]);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
