/**
 * Ukrainian speech in the browser, on the device: the Piper voice `uk_UA-ukrainian_tts-medium`
 * (CC0) run with onnxruntime-web, in a worker so the page stays responsive. None of Piper's GPL
 * engine is used: the text handling is in ukrainianText.ts and the model is run directly.
 *
 * The model is served by this site (public/tts/, see scripts/prepare-tts.mjs) and kept in the
 * browser's Cache Storage after the first load. Downloading it from Hugging Face instead is
 * off unless NEXT_PUBLIC_TTS_HF_FALLBACK=1, because that is a US-hosted download at run time.
 * Either way the bytes are checked against the SHA-256 in voiceManifest.json.
 *
 * Browser only. Typical use:
 *
 *   ukrainianVoice.unlock();            // inside a tap, so later playback is allowed
 *   await ukrainianVoice.load();        // once; about 77 MB the first time, then from cache
 *   if (!(await ukrainianVoice.speak(question))) fallBackToSystemVoice(question);
 */
import type * as Ort from "onnxruntime-web";
import { prepareUkrainian, toIds } from "./ukrainianText";
import voice from "./voiceManifest.json";

export type Speaker = keyof typeof voice.speakers;
/** Where the model came from: this browser's cache, this site, or Hugging Face. */
export type ModelSource = "cache" | "site" | "huggingface";
export type LoadProgress =
  | { phase: "runtime" }
  | { phase: "download"; from: ModelSource; loaded: number; total: number }
  | { phase: "verify" }
  | { phase: "start" };
/** What the map page shows while the voice loads, in Ukrainian: only a speaker who chose Ukrainian sees it [193]. */
export function loadingLabel(p: LoadProgress): string {
  const MB = 1024 * 1024;
  if (p.phase === "download" && p.from !== "cache") return `Завантажую голос: ${Math.floor(p.loaded / MB)} з ${Math.round(p.total / MB)} МБ`;
  if (p.phase === "verify") return "Перевіряю голос…";
  if (p.phase === "start") return "Запускаю голос…";
  return "Завантажую голос…";
}

export type SpeakOptions = {
  speaker?: Speaker;
  /** Keep U+0301 stress marks in the text. Off by default: their effect is unconfirmed. */
  keepStress?: boolean;
};
export type Synthesis = {
  samples: Float32Array;
  sampleRate: number;
  seconds: number;
  /** Time spent in the model. It runs in a worker, so the page keeps responding (decision 105). */
  synthMs: number;
  /** Characters that were skipped because the voice cannot say them. */
  unsupported: string[];
};

const ORT_BASE = "/ort/";
const SITE_BASE = "/tts/";
const CACHE_NAME = "tts-voice-v1";
const HF_FALLBACK = process.env.NEXT_PUBLIC_TTS_HF_FALLBACK === "1";
const SENTENCE_GAP_S = 0.3;
const PEAK = 0.95;

/** Lets the page draw what is pending (the question on screen) before a long model run. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100); // a hidden page gets no animation frames
  });
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return view.buffer;
}

class UkrainianVoice {
  /** Set once the model is loaded. */
  source: ModelSource | null = null;
  /** The most recent synthesis, for timing readouts. */
  last: Synthesis | null = null;

  private ort: typeof Ort | null = null;
  private session: Ort.InferenceSession | null = null;
  private loading: Promise<ModelSource> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private audio: HTMLAudioElement | null = null;
  private clipUrl: string | null = null;
  private turn = 0;

  get ready(): boolean {
    return this.session !== null;
  }

  /** True when the voice is loaded and every character of `text` can be said. */
  canSpeak(text: string): boolean {
    const { sentences, unsupported } = prepareUkrainian(text);
    return this.ready && sentences.length > 0 && unsupported.length === 0;
  }

  /** Downloads (or reads from cache) and starts the model. Safe to call more than once. */
  load(onProgress?: (p: LoadProgress) => void): Promise<ModelSource> {
    this.loading ??= this.start(onProgress ?? (() => {})).catch((err) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  /**
   * Call inside a tap or click. Browsers only let a page play sound later, outside a tap,
   * through an audio element that a tap has already started once.
   */
  unlock(): void {
    const audio = this.element();
    if (audio.dataset.unlocked) return;
    this.setClip(new Float32Array(441), voice.sampleRate); // 20 ms of silence
    audio.play().then(
      () => {
        audio.dataset.unlocked = "1";
      },
      () => {},
    );
  }

  /**
   * Says `text`. Resolves true once sound is playing, or if `stop()` or a newer `speak()` took
   * over. Resolves false when the caller should use another voice: the model is not loaded,
   * the text has characters the voice cannot say, or the browser refused to play.
   */
  async speak(text: string, opts: SpeakOptions = {}): Promise<boolean> {
    if (!this.canSpeak(text)) return false;
    const turn = ++this.turn;
    this.audio?.pause();
    await afterPaint();
    if (turn !== this.turn) return true;
    let result: Synthesis;
    try {
      result = await this.synthesize(text, opts);
    } catch {
      return false;
    }
    if (turn !== this.turn) return true;
    this.setClip(result.samples, result.sampleRate);
    try {
      await this.element().play();
      return true;
    } catch {
      // A pause() from stop() or a newer speak() also lands here; that is not a failure.
      return turn !== this.turn;
    }
  }

  /** Stops what is playing and drops anything still being prepared. */
  stop(): void {
    this.turn++;
    this.audio?.pause();
  }

  /** Text to audio, without playing it. Characters the voice cannot say are skipped and listed. */
  async synthesize(text: string, opts: SpeakOptions = {}): Promise<Synthesis> {
    const { sentences, unsupported } = prepareUkrainian(text, opts);
    if (sentences.length === 0) throw new Error("There is nothing to say in this text.");
    const speaker = voice.speakers[opts.speaker ?? (voice.defaultSpeaker as Speaker)];
    const started = performance.now();
    const gap = new Float32Array(Math.round(voice.sampleRate * SENTENCE_GAP_S));
    const parts: Float32Array[] = [];
    for (const sentence of sentences) {
      const raw = await this.run(toIds(sentence), speaker, voice.scales.noise, voice.scales.noiseW);
      let peak = 0;
      for (let i = 0; i < raw.length; i++) peak = Math.max(peak, Math.abs(raw[i]));
      const gain = peak > 1e-8 ? PEAK / peak : 0;
      if (parts.length) parts.push(gap);
      parts.push(raw.map((s) => s * gain));
    }
    const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      samples.set(p, at);
      at += p.length;
    }
    this.last = {
      samples,
      sampleRate: voice.sampleRate,
      seconds: samples.length / voice.sampleRate,
      synthMs: performance.now() - started,
      unsupported,
    };
    return this.last;
  }

  /** One raw model run, as the model returns it. Runs are queued: the session is not reentrant. */
  run(ids: number[], speakerId: number, noise: number, noiseW: number): Promise<Float32Array> {
    const next = this.queue.then(async () => {
      const { ort, session } = this;
      if (!ort || !session) throw new Error("The Ukrainian voice is not loaded.");
      const out = await session.run({
        input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
        input_lengths: new ort.Tensor("int64", BigInt64Array.of(BigInt(ids.length)), [1]),
        scales: new ort.Tensor("float32", Float32Array.of(noise, voice.scales.length, noiseW), [3]),
        sid: new ort.Tensor("int64", BigInt64Array.of(BigInt(speakerId)), [1]),
      });
      return Float32Array.from(out.output.data as Float32Array);
    });
    this.queue = next.catch(() => {});
    return next;
  }

  private element(): HTMLAudioElement {
    this.audio ??= new Audio();
    return this.audio;
  }

  /** Points the audio element at a new clip and frees the one before it. */
  private setClip(samples: Float32Array, sampleRate: number): void {
    const previous = this.clipUrl;
    this.clipUrl = URL.createObjectURL(new Blob([encodeWav(samples, sampleRate)], { type: "audio/wav" }));
    this.element().src = this.clipUrl;
    if (previous) URL.revokeObjectURL(previous);
  }

  private async start(onProgress: (p: LoadProgress) => void): Promise<ModelSource> {
    onProgress({ phase: "runtime" });
    // Loaded from /public at run time. Bundling it would rewrite the import.meta.url it uses
    // to find its .wasm file.
    const runtimeUrl = new URL(`${ORT_BASE}ort.wasm.min.mjs`, location.href).href;
    const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ runtimeUrl)) as typeof Ort;
    ort.env.wasm.wasmPaths = new URL(ORT_BASE, location.href).href;
    ort.env.wasm.numThreads = 1; // more threads need cross-origin isolation headers the app does not set
    // Starting the model and each sentence froze the page for about a second on a Mac. The proxy
    // runs them in a worker that onnxruntime starts from its own script (decision 105).
    ort.env.wasm.proxy = true;

    const { model, source } = await this.fetchModel(onProgress);
    onProgress({ phase: "start" });
    this.session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"] });
    this.ort = ort;
    this.source = source;
    return source;
  }

  private async fetchModel(onProgress: (p: LoadProgress) => void): Promise<{ model: ArrayBuffer; source: ModelSource }> {
    const key = new URL(`${SITE_BASE}${voice.file}?sha256=${voice.sha256}`, location.href).href;
    const cache = "caches" in globalThis ? await caches.open(CACHE_NAME).catch(() => null) : null;
    const hit = await cache?.match(key);
    if (hit) return { model: await hit.arrayBuffer(), source: "cache" }; // verified before it was stored

    const candidates: [ModelSource, string][] = [["site", new URL(SITE_BASE + voice.file, location.href).href]];
    if (HF_FALLBACK) candidates.push(["huggingface", voice.source + voice.file]);
    const problems: string[] = [];
    for (const [source, url] of candidates) {
      try {
        const model = await this.download(url, (loaded) => onProgress({ phase: "download", from: source, loaded, total: voice.bytes }));
        onProgress({ phase: "verify" });
        if (globalThis.crypto?.subtle) {
          if (hex(await crypto.subtle.digest("SHA-256", model)) !== voice.sha256) throw new Error("checksum mismatch");
        } else if (source !== "site") {
          throw new Error("cannot verify a download on a page that is not served over HTTPS");
        }
        // Best effort: private windows and full disks refuse, and the voice still works this once.
        await cache?.put(key, new Response(model, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => {});
        return { model, source };
      } catch (err) {
        problems.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`Could not load the Ukrainian voice (${problems.join("; ")}).`);
  }

  private async download(url: string, onBytes: (loaded: number) => void): Promise<ArrayBuffer> {
    const res = await fetch(url, { cache: "no-store" }); // kept in Cache Storage instead
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(voice.bytes);
    const reader = res.body.getReader();
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > bytes.length) {
        await reader.cancel();
        throw new Error("larger than the expected model");
      }
      bytes.set(value, loaded);
      loaded += value.length;
      onBytes(loaded);
    }
    if (loaded !== bytes.length) throw new Error("smaller than the expected model");
    return bytes.buffer;
  }
}

export const ukrainianVoice = new UkrainianVoice();
