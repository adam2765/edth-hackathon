import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { measureStretches, parseWav, pitchStrength, segmentTimesMs, VOICED_R, windows, type Pcm } from "../lib/audio/levels";
import { clipSegments, keepClip, keepingClips, type ClipRecord } from "../lib/reports/clips";

const RATE = 16000;

/** A rough stand-in for a voiced vowel: a 140 Hz pulse train through a decaying resonance. */
function voiced(seconds: number, amp: number, f0 = 140): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const period = RATE / f0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < out.length; i++) {
    const pulse = i % Math.round(period) === 0 ? 1 : 0;
    // Two-pole resonance near 700 Hz.
    const y = pulse + 1.8 * Math.cos((2 * Math.PI * 700) / RATE) * 0.95 * y1 - 0.95 * 0.95 * y2;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return out.map((v) => (v / peak) * amp);
}

/** A rough stand-in for a whisper: noise with no pitch, seeded so the test repeats. */
function whispered(seconds: number, amp: number, seed = 7): Float32Array {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => rand() * amp);
}

function join(...parts: Float32Array[]): Pcm {
  const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    samples.set(p, at);
    at += p.length;
  }
  return { sampleRate: RATE, samples };
}

function wav16(pcm: Pcm, channels = 1): Uint8Array<ArrayBuffer> {
  const n = pcm.samples.length;
  const buf = new ArrayBuffer(44 + n * 2 * channels);
  const v = new DataView(buf);
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + n * 2 * channels, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2 * channels, true);
  v.setUint16(32, 2 * channels, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, n * 2 * channels, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) v.setInt16(44 + (i * channels + c) * 2, Math.round(pcm.samples[i] * 32767), true);
  return new Uint8Array(buf);
}

describe("levels", () => {
  it("reads back a 16-bit WAV, and mixes two channels down to one", () => {
    const pcm = join(voiced(0.2, 0.5));
    const back = parseWav(wav16(pcm));
    expect(back.sampleRate).toBe(RATE);
    expect(back.samples.length).toBe(pcm.samples.length);
    expect(Math.abs(back.samples[100] - pcm.samples[100])).toBeLessThan(1e-3);
    expect(parseWav(wav16(pcm, 2)).samples.length).toBe(pcm.samples.length);
    expect(() => parseWav(new Uint8Array(20))).toThrow(/not a WAV/);
  });

  it("finds a pitch in a voiced sound and none in a whisper", () => {
    expect(pitchStrength(join(voiced(0.1, 0.5)), 0)).toBeGreaterThan(VOICED_R);
    expect(pitchStrength(join(whispered(0.1, 0.5)), 0)).toBeLessThan(VOICED_R);
  });

  it("tells a close whisper from a distant voice: the whisper is louder and unvoiced", () => {
    // Silence, a distant voice, silence, a whisper close to the phone, silence.
    const quiet = () => whispered(0.3, 0.0005, 3);
    const pcm = join(quiet(), voiced(1, 0.03), quiet(), whispered(1, 0.2), quiet());
    const m = measureStretches(pcm, [
      { t0_ms: 300, t1_ms: 1300, text: "Many people came up." },
      { t0_ms: 1600, t1_ms: 2600, text: "Heading towards the cemetery." },
      { t0_ms: 0, t1_ms: 250 },
    ]);
    const [far, close, silence] = m.stretches;
    expect(far.voiced!).toBeGreaterThan(0.8);
    expect(close.voiced!).toBeLessThan(0.2);
    expect(close.level_db! - far.level_db!).toBeGreaterThan(10);
    expect(silence.level_db).toBeNull();
    expect(silence.speech_ms).toBe(0);
  });

  it("takes Whisper's times in 10 ms steps or in milliseconds, whichever fits the clip", () => {
    expect(segmentTimesMs([{ t0: 0, t1: 150 }, { t0: 150, t1: 420 }], 4300).map((s) => s.t1_ms)).toEqual([1500, 4200]);
    expect(segmentTimesMs([{ t0: 0, t1: 1500 }, { t0: 1500, t1: 4200 }], 4300).map((s) => s.t1_ms)).toEqual([1500, 4200]);
    expect(windows(2500)).toEqual([{ t0_ms: 0, t1_ms: 1000 }, { t0_ms: 1000, t1_ms: 2000 }, { t0_ms: 2000, t1_ms: 2500 }]);
  });
});

describe("clips", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
    delete process.env.KEEP_CLIPS;
    delete process.env.VERCEL;
  });

  it("are kept only with KEEP_CLIPS=1, and never on Vercel", () => {
    expect(keepingClips()).toBe(false);
    process.env.KEEP_CLIPS = "1";
    expect(keepingClips()).toBe(true);
    process.env.VERCEL = "1";
    expect(keepingClips()).toBe(false);
  });

  it("reads the segments field and drops what is not a segment", () => {
    expect(clipSegments(null)).toBeNull();
    expect(clipSegments("not json")).toBeNull();
    expect(clipSegments(JSON.stringify([{ text: "Heading towards the cemetery.", t0: 150, t1: 310 }, { text: "bad", t0: 5, t1: 2 }, { t0: 1, t1: 2 }]))).toEqual([
      { text: "Heading towards the cemetery.", t0: 150, t1: 310 },
    ]);
  });

  it("writes the clip and a record beside it", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "clips-"));
    const audio = new File([wav16(join(voiced(0.2, 0.5)))], "recording.wav", { type: "audio/wav" });
    const record: ClipRecord = {
      ts: Date.parse("2026-11-21T10:00:00Z"),
      session: "demo",
      callsign: "ALPHA 1",
      seq: 5,
      source: "phone",
      transcript: "Heading towards the cemetery.",
      segments: [{ text: "Heading towards the cemetery.", t0: 0, t1: 20 }],
      language: "en",
      status: "resolved",
      rule: "category_unique",
      detail: "",
      timings_ms: { total: 700 },
    };
    const file = await keepClip(audio, record, dir);
    expect(file).toBe("2026-11-21T10-00-00-000Z-alpha-1-5.wav");
    const saved = JSON.parse(readFileSync(path.join(dir, "2026-11-21T10-00-00-000Z-alpha-1-5.json"), "utf8"));
    expect(saved).toMatchObject({ callsign: "ALPHA 1", source: "phone", file });
    expect(parseWav(readFileSync(path.join(dir, file!))).samples.length).toBe(3200);
  });
});

describe("the report endpoint with a clip", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
    delete process.env.KEEP_CLIPS;
    delete process.env.CLIPS_DIR;
  });

  it("keeps a clip the phone heard no words in, and says so in the reply", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "clips-"));
    process.env.KEEP_CLIPS = "1";
    process.env.CLIPS_DIR = dir;
    const { POST } = await import("../app/api/report/route");
    const form = new FormData();
    form.append("clip", new File([wav16(join(whispered(0.5, 0.1)))], "recording.wav", { type: "audio/wav" }));
    form.append("segments", "[]");
    form.append("callsign", "ALPHA 1");
    form.append("seq", "9");
    form.append("language", "en");
    const res = await POST(new Request("http://localhost/api/report", { method: "POST", body: form }));
    const reply = await res.json();
    expect(res.status).toBe(200);
    expect(reply.transcript).toBe("");
    expect(reply.resolution.evidence.rule).toBe("empty_transcript");
    expect(reply.clip).toMatch(/-alpha-1-9\.wav$/);
    const saved = JSON.parse(readFileSync(path.join(dir, reply.clip.replace(/\.wav$/, ".json")), "utf8"));
    expect(saved).toMatchObject({ source: "phone", transcript: "", rule: "empty_transcript" });
  });

  it("without KEEP_CLIPS, keeps nothing and the reply has no clip", async () => {
    const { POST } = await import("../app/api/report/route");
    const form = new FormData();
    form.append("clip", new File([wav16(join(whispered(0.5, 0.1)))], "recording.wav", { type: "audio/wav" }));
    const reply = await (await POST(new Request("http://localhost/api/report", { method: "POST", body: form }))).json();
    expect(reply.clip).toBeUndefined();
  });
});
