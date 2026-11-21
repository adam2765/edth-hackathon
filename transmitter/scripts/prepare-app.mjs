// Expo 58 compiles these launcher instructions into the native app.
// Keep the instructions aligned with the project launcher after npm ci/prebuild.
import { readFile, writeFile } from "node:fs/promises";

const files = [
  "android/src/debug/java/expo/modules/devlauncher/compose/ui/DevelopmentSession.kt",
  "ios/SwiftUI/DevServerInfoModal.swift",
  "ios/SwiftUI/DevLauncherLoadErrorMessage.swift",
  "ios/Tests/DevLauncherLoadErrorMessageTests.swift",
];
const changes = [
  ["npx expo start", "npm start"],
  ["Start a local development server with:", "Start the servers from the project folder on your computer:"],
  ["Then, select the local server when it appears here.", "For lower memory use, run npm start light. Then select Transmitter when it appears here."],
];
for (const file of files) {
  const target = new URL(`../node_modules/expo-dev-launcher/${file}`, import.meta.url);
  const before = await readFile(target, "utf8");
  let after = before;
  for (const [oldText, newText] of changes) after = after.replaceAll(oldText, newText);
  if (!after.includes("npm start")) throw new Error(`Expo launcher instructions changed; review ${file}.`);
  if (after !== before) await writeFile(target, after);
}
console.log("Phone launcher instructions ready. Audio transcription runs on the coordinator.");
