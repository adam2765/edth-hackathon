/**
 * Measures the clips the coordinator kept with KEEP_CLIPS=1: for each stretch Whisper timed on the
 * phone, how loud it is and whether it is voiced or whispered (lib/audio/levels.ts). A clip with no
 * segments (sent for speech-to-text on the server) is measured in one-second windows.
 *
 * Run: npx tsx scripts/clip-levels.ts                every clip in .data/clips, oldest first
 *      npx tsx scripts/clip-levels.ts <file.json> …  only these
 *      add --json for one JSON line per clip
 * Clips that are not WAV (m4a from the server path) are converted with macOS `afconvert` first.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { measureStretches, parseWav, segmentTimesMs, windows, type Pcm } from "../lib/audio/levels";
import { clipsDir, type ClipRecord } from "../lib/reports/clips";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const named = args.filter((a) => !a.startsWith("--"));
const dir = clipsDir();
const files = named.length ? named : readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(dir, f));
if (!files.length) {
  console.log(`No clips in ${dir}. Start the coordinator with KEEP_CLIPS=1 and turn on "Send clips" on the phone.`);
  process.exit(0);
}

function load(audioPath: string): Pcm {
  if (audioPath.toLowerCase().endsWith(".wav")) return parseWav(readFileSync(audioPath));
  const tmp = mkdtempSync(path.join(tmpdir(), "clip-"));
  try {
    const wav = path.join(tmp, "clip.wav");
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", audioPath, wav]);
    return parseWav(readFileSync(wav));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const sec = (ms: number) => (ms / 1000).toFixed(1);

for (const jsonPath of files) {
  const record = JSON.parse(readFileSync(jsonPath, "utf8")) as ClipRecord & { file: string };
  const audioPath = path.join(path.dirname(jsonPath), record.file);
  let pcm: Pcm;
  try {
    pcm = load(audioPath);
  } catch (err) {
    console.log(`${record.file}: cannot read (${(err as Error).message})`);
    continue;
  }
  const clipMs = (pcm.samples.length / pcm.sampleRate) * 1000;
  const stretches = record.segments?.length ? segmentTimesMs(record.segments, clipMs) : windows(clipMs);
  const m = measureStretches(pcm, stretches);
  if (asJson) {
    console.log(JSON.stringify({ file: record.file, source: record.source, clip_ms: Math.round(clipMs), transcript: record.transcript, rule: record.rule, ...m }));
    continue;
  }
  console.log(`\n${record.file}  ${record.source}, ${sec(clipMs)} s, floor ${m.floor_db} dB`);
  console.log(`  heard: ${record.transcript ? `"${record.transcript}"` : "(no words)"}`);
  console.log(`  read:  ${record.status} (${record.rule})${record.question ? `: ${record.question}` : ""}`);
  console.log(`  time          level    voiced  ${record.segments?.length ? "words" : ""}`);
  for (const s of m.stretches) {
    const level = s.level_db == null ? "  quiet " : `${s.level_db.toFixed(1).padStart(6)} dB`;
    const voiced = s.voiced == null ? "   -  " : `${(s.voiced * 100).toFixed(0).padStart(4)} %`;
    console.log(`  ${`${sec(s.t0_ms)}–${sec(s.t1_ms)} s`.padEnd(13)} ${level}  ${voiced}  ${s.text ?? ""}`);
  }
}
