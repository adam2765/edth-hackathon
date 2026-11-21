/**
 * Test clips. With KEEP_CLIPS=1 the coordinator keeps the audio of each report in `.data/clips/`,
 * with a JSON file beside it: what was heard, Whisper's timed segments when the phone sent them,
 * and how the report was read. For measuring whispers and other voices with
 * `scripts/clip-levels.ts`. Off by default and never on Vercel. Clips are recordings of people's
 * voices: delete them when the test is done. Server only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function keepingClips(): boolean {
  return process.env.KEEP_CLIPS === "1" && !process.env.VERCEL;
}

export function clipsDir(): string {
  return path.resolve(process.env.CLIPS_DIR ?? ".data/clips");
}

/** A stretch of speech as Whisper on the phone timed it, in the units the phone's library gives. */
export interface ClipSegment {
  text: string;
  t0: number;
  t1: number;
}

const MAX_SEGMENTS = 200;

/** The `segments` field of a report: a JSON list of `{ text, t0, t1 }`. Null when absent or not valid. */
export function clipSegments(v: FormDataEntryValue | null): ClipSegment[] | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const list = JSON.parse(v);
    if (!Array.isArray(list)) return null;
    const out = list
      .slice(0, MAX_SEGMENTS)
      .filter((s) => s && typeof s.text === "string" && Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 >= s.t0 && s.t0 >= 0)
      .map((s) => ({ text: String(s.text).slice(0, 500), t0: Number(s.t0), t1: Number(s.t1) }));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

const EXT = /\.(wav|m4a|mp4|aac|caf|webm|ogg|mp3)$/i;

function extensionOf(audio: Blob): string {
  const name = (audio as File).name ?? "";
  const m = name.match(EXT);
  if (m) return m[1].toLowerCase();
  const t = audio.type;
  if (t.includes("wav")) return "wav";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "m4a";
  if (t.includes("webm")) return "webm";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mpeg")) return "mp3";
  return "bin";
}

export interface ClipRecord {
  ts: number;
  session: string | null;
  callsign: string;
  seq: number | null;
  /** "phone": Whisper ran on the phone and the clip came beside the text; "server": the clip was the report. */
  source: "phone" | "server";
  transcript: string;
  segments: ClipSegment[] | null;
  language: string | null;
  status: string;
  rule: string;
  detail: string;
  question?: string;
  report_id?: string;
  timings_ms: Record<string, number>;
}

/** Writes the clip and its record. Returns the clip's file name, or null if it could not be kept. */
export async function keepClip(audio: Blob, record: ClipRecord, dir = clipsDir()): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true });
    const stamp = new Date(record.ts).toISOString().replace(/[:.]/g, "-");
    const who = record.callsign.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "unknown";
    const base = `${stamp}-${who}-${record.seq ?? "x"}`;
    const file = `${base}.${extensionOf(audio)}`;
    await writeFile(path.join(dir, file), Buffer.from(await audio.arrayBuffer()));
    await writeFile(path.join(dir, `${base}.json`), JSON.stringify({ ...record, file }, null, 2) + "\n");
    return file;
  } catch (err) {
    console.error("keeping the clip failed", err);
    return null;
  }
}
