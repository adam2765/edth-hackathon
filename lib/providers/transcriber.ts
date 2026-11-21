/**
 * Speech-to-text seam. Mistral, with MISTRAL_API_KEY.
 * Mistral is asked to tell speakers apart (diarization): where the speaker changes, the transcript
 * gets a ">>" mark, the same mark lib/geo/voices.ts splits voice turns at. MISTRAL_STT_DIARIZE=0 turns it off.
 * GRADIUM_API_KEY is recognised but its transcriber is not built in stage 1.
 * A local model can be added later behind the same interface; until then PROVIDER_MODE=local takes text only.
 */
import { providerMode } from "./mode";
import { fetchRetrying } from "./retry";

export interface TranscribeResult {
  text: string;
  /** ISO 639-1 if the provider reports it */
  language: string | null;
}

export interface Transcriber {
  name: string;
  transcribe(audio: Blob, mime: string, biasTerms: string[]): Promise<TranscribeResult>;
}

/** A stretch of speech as Mistral returns it with segment timestamps. */
export interface SpeakerSegment {
  text: string;
  speaker_id?: string | null;
  start?: number;
  end?: number;
}

/**
 * One transcript from diarized segments: consecutive segments of one speaker are joined with a
 * space, and a change of speaker is marked ">>". A segment with no speaker label joins the one before.
 */
export function joinSpeakers(segments: SpeakerSegment[]): string {
  let out = "";
  let last: string | null | undefined;
  for (const seg of segments) {
    const text = (seg.text ?? "").trim();
    if (!text) continue;
    const who = seg.speaker_id ?? last;
    if (out && who != null && last != null && who !== last) out += " >> ";
    else if (out) out += " ";
    out += text;
    last = who;
  }
  return out;
}

const diarizeOn = () => process.env.MISTRAL_STT_DIARIZE !== "0";

/** Mistral refused the diarization options (400 or 422); a timeout or an outage is not this. */
class DiarizeRefused extends Error {}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "webm";
}

class MistralTranscriber implements Transcriber {
  name: string;
  constructor(
    private apiKey: string,
    private model = process.env.MISTRAL_STT_MODEL || "voxtral-mini-transcribe-3",
  ) {
    this.name = `mistral:${this.model}`;
  }

  async transcribe(audio: Blob, mime: string, biasTerms: string[]): Promise<TranscribeResult> {
    if (diarizeOn()) {
      try {
        return await this.request(audio, mime, biasTerms, true);
      } catch (err) {
        if (!(err instanceof DiarizeRefused)) throw err;
        // A refused option must not cost the report: transcribe again as before.
        console.warn(`[stt] diarization refused, transcribing without it: ${err.message}`);
      }
    }
    return this.request(audio, mime, biasTerms, false);
  }

  private async request(audio: Blob, mime: string, biasTerms: string[], diarize: boolean): Promise<TranscribeResult> {
    const form = new FormData();
    form.append("file", new File([audio], `clip.${extFor(mime)}`, { type: mime.split(";")[0] }));
    form.append("model", this.model);
    form.append("return_language", "true");
    if (diarize) {
      // Diarization labels segments, so it needs segment timestamps (Mistral docs, 21 Nov 2026).
      form.append("diarize", "true");
      form.append("timestamp_granularities", "segment");
    }
    // Repeated field, one entry per term (checked against Mistral docs and live API, 20 Nov 2026).
    for (const t of biasTerms.slice(0, 100)) form.append("context_bias", t);
    const res = await fetchRetrying("https://api.mistral.ai/v1/audio/transcriptions", () => ({
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    }));
    if (!res.ok) {
      const msg = `Mistral STT ${res.status}: ${(await res.text()).slice(0, 200)}`;
      throw diarize && (res.status === 400 || res.status === 422) ? new DiarizeRefused(msg) : new Error(msg);
    }
    const j = (await res.json()) as { text?: string; language?: string | null; segments?: SpeakerSegment[] };
    const text = diarize && j.segments?.length ? joinSpeakers(j.segments) : (j.text ?? "");
    return { text: text.trim(), language: j.language ?? null };
  }
}

let cached: Transcriber | null = null;

/** Thrown in local mode when audio arrives: there is no speech-to-text on this computer yet. */
export class NoLocalTranscriberError extends Error {
  constructor() {
    super("PROVIDER_MODE=local has no speech-to-text on this computer yet");
    this.name = "NoLocalTranscriberError";
  }
}

export function getTranscriber(): Transcriber {
  if (cached) return cached;
  // Local mode never sends audio to Mistral, even with a key set.
  if (providerMode() === "local") throw new NoLocalTranscriberError();
  if (process.env.MISTRAL_API_KEY) cached = new MistralTranscriber(process.env.MISTRAL_API_KEY);
  else if (process.env.GRADIUM_API_KEY) throw new Error("GRADIUM_API_KEY is set but the Gradium transcriber is not built in stage 1");
  else throw new Error("No speech-to-text key: set MISTRAL_API_KEY, or run offline with PROVIDER_MODE=local and send text (docs/setup.md, part 3)");
  return cached;
}
