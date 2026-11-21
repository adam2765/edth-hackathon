import { requireOptionalNativeModule } from "expo";

// Optional so iOS keeps using expo-audio and does not need this Android-only module.
const recorder = requireOptionalNativeModule<{ start(): Promise<void>; stop(): Promise<string> }>("PcmRecorder");

export async function startPcm(): Promise<void> {
  if (!recorder) throw new Error("Rebuild the Android development app to enable phone recording.");
  await recorder.start();
}

export async function stopPcm(): Promise<string> {
  return recorder ? recorder.stop() : "";
}
