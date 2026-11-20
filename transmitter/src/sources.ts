// Audio sources. Each one ends in the same thing: a local audio file for an Utterance.
//   scenario clip  a prepared clip bundled with the app (silent testing, simulator, emulator)
//   microphone     hold to talk (see useMicSource in App.tsx, which owns the recorder hook)
//   open mic       later: continuous listening that cuts at pauses
import { Asset } from "expo-asset";
import { AudioQuality, IOSOutputFormat, type RecordingOptions } from "expo-audio";

/** Local file URI of a bundled clip (a Metro asset id). */
export async function clipUri(assetId: number): Promise<string> {
  const asset = Asset.fromModule(assetId);
  if (!asset.localUri) await asset.downloadAsync();
  if (!asset.localUri) throw new Error("A bundled clip is not available");
  return asset.localUri;
}

/** Speech-sized recording: 16 kHz mono AAC in an m4a file, the same as the scenario clips. */
export const SPEECH_RECORDING: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: { mimeType: "audio/webm", bitsPerSecond: 32000 },
};

/**
 * Uncompressed 16 kHz mono recording, for speech-to-text on the phone. iOS only: Android's
 * recorder cannot write uncompressed audio, so there the open-microphone stream will be used.
 */
export const SPEECH_RECORDING_WAV: RecordingOptions = {
  ...SPEECH_RECORDING,
  extension: ".wav",
  bitRate: 256000,
  ios: { outputFormat: IOSOutputFormat.LINEARPCM, audioQuality: AudioQuality.HIGH, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
};

export const MAX_CLIP_MS = 15_000;
export const MIN_CLIP_MS = 350;
