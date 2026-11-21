// Where speech becomes text.
//   "server"        the clip is uploaded and the coordinator transcribes it (Mistral)
//   "phone-base"    Whisper base runs on the phone and only the text is sent
//   "phone-small"   Whisper small, slower and more accurate
// The phone modes need a model file, downloaded once from Hugging Face into the app's documents.
import * as Device from "expo-device";
import { Directory, File, Paths } from "expo-file-system";
import { initWhisper, type WhisperContext } from "whisper.rn";
import hints from "./hints.generated.json";
import type { AreaId, PhoneSegment } from "./types";

export type SttMode = "server" | "phone-base" | "phone-small";
export type PhoneMode = Exclude<SttMode, "server">;

export const STT_MODES: { id: SttMode; label: string }[] = [
  { id: "server", label: "Server" },
  { id: "phone-base", label: "Phone: base" },
  { id: "phone-small", label: "Phone: small" },
];

export const PHONE_MODELS: Record<PhoneMode, { file: string; mb: number }> = {
  "phone-base": { file: "ggml-base-q5_1.bin", mb: 56 },
  "phone-small": { file: "ggml-small-q5_1.bin", mb: 181 },
};

const MODEL_SOURCE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

function modelsDir(): Directory {
  return new Directory(Paths.document, "models");
}

export function modelFile(mode: PhoneMode): File {
  return new File(modelsDir(), PHONE_MODELS[mode].file);
}

export function hasModel(mode: PhoneMode): boolean {
  const f = modelFile(mode);
  // A partial download is smaller than the real file: treat it as missing.
  return f.exists && (f.size ?? 0) > PHONE_MODELS[mode].mb * 1024 * 1024 * 0.9;
}

export async function downloadModel(mode: PhoneMode, onProgress?: (fraction: number) => void): Promise<void> {
  const dir = modelsDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const target = modelFile(mode);
  if (target.exists) target.delete();
  await File.downloadFileAsync(`${MODEL_SOURCE}/${PHONE_MODELS[mode].file}`, target, {
    onProgress: (p) => {
      if (onProgress && p.totalBytes > 0) onProgress(p.bytesWritten / p.totalBytes);
    },
  });
}

/** Place names, most useful first, then report words: the prompt for the phone's speech-to-text (scripts/build-transmitter-hints.ts). */
export function hintPrompt(area: AreaId): string {
  const names = (hints as Record<string, string[]>)[area] ?? [];
  return names.join(", ");
}

let loaded: { mode: PhoneMode; context: WhisperContext } | null = null;

export interface PhoneTranscript {
  text: string;
  language: string | null;
  ms: number;
  /** Timed stretches, for test clips: loudness and whispering are measured per stretch. */
  segments: PhoneSegment[];
}

/** Transcribes a 16 kHz mono WAV file on the phone. Loads the model on first use. */
export async function transcribeOnPhone(mode: PhoneMode, wavUri: string, opts: { prompt?: string; language?: string } = {}): Promise<PhoneTranscript> {
  if (!loaded || loaded.mode !== mode) {
    if (loaded) await loaded.context.release();
    loaded = null;
    // The simulator has no usable GPU for Whisper; a real phone does.
    const context = await initWhisper({ filePath: modelFile(mode).uri, useGpu: Device.isDevice });
    loaded = { mode, context };
  }
  const t0 = Date.now();
  const { promise } = loaded.context.transcribe(wavUri, { language: opts.language ?? "auto", prompt: opts.prompt || undefined, maxThreads: 4 });
  const r = await promise;
  const segments = (r.segments ?? []).map((s) => ({ text: s.text.trim(), t0: s.t0, t1: s.t1 }));
  return { text: r.result.trim(), language: r.language || null, ms: Date.now() - t0, segments };
}
