/**
 * How loud each stretch of a recording is, and whether it is voiced or whispered: the measures for
 * telling the person at the phone from other voices. Pure: samples in, numbers out. Used by
 * `scripts/clip-levels.ts` on the clips the coordinator keeps with KEEP_CLIPS=1.
 *
 *   level_db  the stretch's speech level: the 90th percentile of its 20 ms frame levels, in dB below
 *             full scale. A voice at the phone is louder than one across the room.
 *   voiced    the share of its speech frames that have a pitch (70 to 400 Hz). A whisper has none, so
 *             it is near 0; a normal voice is well above half.
 */

export interface Pcm {
  sampleRate: number;
  /** Mono, -1 to 1. */
  samples: Float32Array;
}

/** Reads a WAV file: 16-bit or 24-bit PCM, or 32-bit float, mixed down to mono. */
export function parseWav(buf: Uint8Array): Pcm {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number) => String.fromCharCode(buf[at], buf[at + 1], buf[at + 2], buf[at + 3]);
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = tag(at);
    let size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      if (!format) throw new Error("WAV data before its format");
      // A recorder stopped early can leave the size at 0 or too large: read what is there.
      if (size === 0 || body + size > buf.length) size = buf.length - body;
      const width = bits / 8;
      const frames = Math.floor(size / (width * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width;
          if (format === 3 && bits === 32) sum += view.getFloat32(p, true);
          else if (format === 1 && bits === 16) sum += view.getInt16(p, true) / 32768;
          else if (format === 1 && bits === 24) sum += ((view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16)) / 8388608);
          else throw new Error(`unsupported WAV format ${format}, ${bits} bits`);
        }
        samples[i] = sum / channels;
      }
      return { sampleRate, samples };
    }
    at = body + size + (size % 2);
  }
  throw new Error("WAV file has no data");
}

const FRAME_MS = 20;
const HOP_MS = 10;
/** Pitch needs two periods of the lowest voice: 2 × 1/70 s ≈ 29 ms. */
const PITCH_FRAME_MS = 40;
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 400;
/** A frame with a normalised self-similarity above this at some pitch period is voiced. */
export const VOICED_R = 0.5;
/** Frames this far above the clip's quietest tenth count as speech. */
const SPEECH_ABOVE_FLOOR_DB = 6;

const dB = (rms: number) => 20 * Math.log10(rms + 1e-9);

function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

/** Level of each 20 ms frame, every 10 ms, in dB below full scale. */
export function frameLevels(pcm: Pcm): number[] {
  const n = Math.round((pcm.sampleRate * FRAME_MS) / 1000);
  const hop = Math.round((pcm.sampleRate * HOP_MS) / 1000);
  const out: number[] = [];
  for (let start = 0; start + n <= pcm.samples.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + n; i++) sum += pcm.samples[i] * pcm.samples[i];
    out.push(dB(Math.sqrt(sum / n)));
  }
  return out;
}

/** The strongest normalised self-similarity of the 40 ms frame starting at `start`, over pitch periods. */
export function pitchStrength(pcm: Pcm, start: number): number {
  const n = Math.round((pcm.sampleRate * PITCH_FRAME_MS) / 1000);
  const minLag = Math.floor(pcm.sampleRate / PITCH_MAX_HZ);
  const maxLag = Math.ceil(pcm.sampleRate / PITCH_MIN_HZ);
  const len = n - maxLag;
  if (len <= 0 || start + n > pcm.samples.length) return 0;
  const x = pcm.samples;
  let mean = 0;
  for (let i = start; i < start + n; i++) mean += x[i];
  mean /= n;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = start; i < start + len; i++) {
      const a = x[i] - mean;
      const b = x[i + lag] - mean;
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    const r = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    if (r > best) best = r;
  }
  return best;
}

export interface Stretch {
  /** Milliseconds from the start of the clip. */
  t0_ms: number;
  t1_ms: number;
  text?: string;
}

export interface StretchLevels extends Stretch {
  /** Speech level in dB below full scale; null when the stretch holds no frame above the floor. */
  level_db: number | null;
  /** Share of speech frames with a pitch, 0 to 1; null with no speech frames. */
  voiced: number | null;
  speech_ms: number;
}

/** Measures each stretch against the floor of the whole clip. */
export function measureStretches(pcm: Pcm, stretches: Stretch[]): { floor_db: number; stretches: StretchLevels[] } {
  const levels = frameLevels(pcm);
  const floor = percentile(levels, 10);
  const hop = (pcm.sampleRate * HOP_MS) / 1000;
  const out = stretches.map((s): StretchLevels => {
    const first = Math.max(0, Math.floor(s.t0_ms / HOP_MS));
    const last = Math.min(levels.length, Math.ceil(s.t1_ms / HOP_MS));
    const speech: number[] = [];
    for (let f = first; f < last; f++) if (levels[f] >= floor + SPEECH_ABOVE_FLOOR_DB) speech.push(f);
    if (!speech.length) return { ...s, level_db: null, voiced: null, speech_ms: 0 };
    const voiced = speech.filter((f) => pitchStrength(pcm, Math.round(f * hop)) > VOICED_R).length;
    return {
      ...s,
      level_db: Math.round(percentile(speech.map((f) => levels[f]), 90) * 10) / 10,
      voiced: Math.round((voiced / speech.length) * 100) / 100,
      speech_ms: speech.length * HOP_MS,
    };
  });
  return { floor_db: Math.round(floor * 10) / 10, stretches: out };
}

/**
 * Whisper's segment times in milliseconds. whisper.cpp counts in 10 ms steps; whether the phone's
 * library passes them on like that is not documented, so the clip's length decides.
 */
export function segmentTimesMs<T extends { t0: number; t1: number }>(segments: T[], clipMs: number): (T & Stretch)[] {
  const last = Math.max(0, ...segments.map((s) => s.t1));
  const scale = last * 10 <= clipMs * 1.5 ? 10 : 1;
  return segments.map((s) => ({ ...s, t0_ms: s.t0 * scale, t1_ms: s.t1 * scale }));
}

/** One-second windows over the whole clip, for a clip with no segments. */
export function windows(clipMs: number, stepMs = 1000): Stretch[] {
  const out: Stretch[] = [];
  for (let t = 0; t < clipMs; t += stepMs) out.push({ t0_ms: t, t1_ms: Math.min(clipMs, t + stepMs) });
  return out;
}
