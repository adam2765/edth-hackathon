/**
 * Speech-to-text seam. Picked by which key is in the environment:
 * MISTRAL_API_KEY, else ELEVENLABS_API_KEY, else GRADIUM_API_KEY.
 * A local model can be added later behind the same interface.
 */
export interface TranscribeResult {
  text: string;
  /** ISO 639-1 if the provider reports it */
  language: string | null;
}

export interface Transcriber {
  name: string;
  transcribe(audio: Blob, mime: string, biasTerms: string[]): Promise<TranscribeResult>;
}

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
    const form = new FormData();
    form.append("file", new File([audio], `clip.${extFor(mime)}`, { type: mime.split(";")[0] }));
    form.append("model", this.model);
    form.append("return_language", "true");
    // Repeated field, one entry per term (checked against Mistral docs and live API, 20 Nov 2026).
    for (const t of biasTerms.slice(0, 100)) form.append("context_bias", t);
    const res = await fetch("https://api.mistral.ai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Mistral STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { text?: string; language?: string | null };
    return { text: (j.text ?? "").trim(), language: j.language ?? null };
  }
}

/** Stage-1 fallback, not exercised: endpoint and fields from ElevenLabs docs, unverified here. */
class ElevenLabsTranscriber implements Transcriber {
  name = "elevenlabs:scribe_v1";
  constructor(private apiKey: string) {}
  async transcribe(audio: Blob, mime: string): Promise<TranscribeResult> {
    const form = new FormData();
    form.append("file", new File([audio], `clip.${extFor(mime)}`, { type: mime.split(";")[0] }));
    form.append("model_id", "scribe_v1");
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { text?: string; language_code?: string };
    return { text: (j.text ?? "").trim(), language: j.language_code?.slice(0, 2) ?? null };
  }
}

let cached: Transcriber | null = null;

export function getTranscriber(): Transcriber {
  if (cached) return cached;
  if (process.env.MISTRAL_API_KEY) cached = new MistralTranscriber(process.env.MISTRAL_API_KEY);
  else if (process.env.ELEVENLABS_API_KEY) cached = new ElevenLabsTranscriber(process.env.ELEVENLABS_API_KEY);
  else if (process.env.GRADIUM_API_KEY) throw new Error("GRADIUM_API_KEY is set but the Gradium transcriber is not built in stage 1");
  else throw new Error("No speech-to-text key: set MISTRAL_API_KEY (or ELEVENLABS_API_KEY)");
  return cached;
}
