// Runs once when the server starts.
// - Offline mode: loads the extraction model and each area's prompt in the background, so the first
//   report is not the slow one (decision 85). It does not wait for that: the server takes requests
//   at once, and an early report queues behind the warm-up. It also says whether whisper-server,
//   the speech-to-text on this computer, answers.
// - Hosted mode with no key: says at once how to run without one, instead of failing on the first report.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { providerMode } = await import("./lib/providers/mode");
  if (providerMode() !== "local") {
    if (!process.env.MISTRAL_API_KEY && !process.env.FEATHERLESS_API_KEY) {
      console.warn("[providers] Hosted mode with no MISTRAL_API_KEY: reports will fail. Run offline with PROVIDER_MODE=local (no key needed; docs/setup.md, part 3), or add a key to .env.local.");
    }
    return;
  }
  console.log("[providers] Offline mode: speech-to-text through whisper-server and extraction through Ollama, both on this computer; no key needed.");
  const { checkLocalTranscriber } = await import("./lib/providers/transcriber");
  void checkLocalTranscriber();
  const { warmUpExtractor } = await import("./lib/providers/extractor");
  const { AREAS } = await import("./lib/geo/areas");
  void warmUpExtractor(Object.values(AREAS).map((a) => a.place));
}
