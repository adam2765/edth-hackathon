// Speech always becomes text on the phone, using the fixed Whisper base model.
import { Asset } from "expo-asset";
import * as Device from "expo-device";
import { Directory, File, Paths } from "expo-file-system";
import { initWhisper, type WhisperContext } from "whisper.rn";
import hints from "./hints.generated.json";
import manifest from "./modelManifest.json";
import type { AreaId, PhoneSegment } from "./types";

const modelAsset = require("../assets/models/ggml-base-q5_1.bin");

function modelFile(): File {
  return new File(Paths.document, "models", manifest.file);
}

export function hasModel(): boolean {
  const file = modelFile();
  return file.exists && file.size === manifest.bytes;
}

let installing: Promise<void> | null = null;

/** Installs the setup-provided asset automatically; never downloads from Hugging Face on the phone. */
export function ensureModel(): Promise<void> {
  if (hasModel()) return Promise.resolve();
  if (!installing) {
    installing = installModel().catch((error) => {
      installing = null;
      throw error;
    });
  }
  return installing;
}

async function installModel(): Promise<void> {
  const dir = new Directory(Paths.document, "models");
  if (!dir.exists) dir.create({ intermediates: true });
  const asset = await Asset.fromModule(modelAsset).downloadAsync();
  if (!asset.localUri) throw new Error("Speech model is unavailable. Run npm run setup on the Mac and reopen the app.");
  const temporary = new File(dir, `${manifest.file}.installing`);
  let installed = false;
  try {
    if (temporary.exists) temporary.delete();
    new File(asset.localUri).copy(temporary);
    if (temporary.size !== manifest.bytes) throw new Error("Speech model is incomplete. Run npm run setup on the Mac and reopen the app.");
    const target = modelFile();
    if (target.exists) target.delete();
    temporary.move(target);
    installed = true;
  } finally {
    if (!installed && temporary.exists) temporary.delete();
  }
}

/** Place names, most useful first, then report words: the prompt for the phone's speech-to-text (scripts/build-transmitter-hints.ts). */
export function hintPrompt(area: AreaId): string {
  const names = (hints as Record<string, string[]>)[area] ?? [];
  return names.join(", ");
}

let loaded: WhisperContext | null = null;

export interface PhoneTranscript {
  text: string;
  language: string | null;
  ms: number;
  /** Timed stretches, for test clips: loudness and whispering are measured per stretch. */
  segments: PhoneSegment[];
}

/** Transcribes a 16 kHz mono WAV file on the phone. Loads the model on first use. */
export async function transcribeOnPhone(wavUri: string, opts: { prompt?: string; language?: string } = {}): Promise<PhoneTranscript> {
  await ensureModel();
  if (!loaded) {
    loaded = await initWhisper({ filePath: modelFile().uri, useGpu: Device.isDevice });
  }
  const t0 = Date.now();
  const { promise } = loaded.transcribe(wavUri, { language: opts.language ?? "auto", prompt: opts.prompt || undefined, maxThreads: 4 });
  const r = await promise;
  const segments = (r.segments ?? []).map((s) => ({ text: s.text.trim(), t0: s.t0, t1: s.t1 }));
  return { text: r.result.trim(), language: r.language || null, ms: Date.now() - t0, segments };
}
