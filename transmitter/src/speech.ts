import * as Speech from "expo-speech";
import type { Lang } from "./types";

const LOCALE: Record<Lang, string> = { en: "en-GB", fr: "fr-FR", uk: "uk-UA" };

/** Speaks the coordinator's question. Resolves when the phone has finished (or failed) speaking. */
export function speak(text: string, lang: Lang): Promise<void> {
  return new Promise((resolve) => {
    Speech.stop()
      .catch(() => {})
      .finally(() => {
        Speech.speak(text, { language: LOCALE[lang], onDone: () => resolve(), onStopped: () => resolve(), onError: () => resolve() });
      });
  });
}

export function stopSpeaking(): void {
  Speech.stop().catch(() => {});
}
