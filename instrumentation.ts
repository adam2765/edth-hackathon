// Runs once when the server starts.
// - Offline mode: loads the extraction model and each area's prompt in the background, so the first
//   report is not the slow one (decision 85). It does not wait for that: the server takes requests
//   at once, and an early report queues behind the warm-up. It also says whether whisper-server,
//   the speech-to-text on this computer, answers.
// - Hosted mode with no key: says at once how to run without one, instead of failing on the first report.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startHostDirectory } = await import("./lib/runtime/hosts");
  startHostDirectory();
  const { providerMode } = await import("./lib/providers/mode");
  const { setReady } = await import("./lib/providers/readiness");
  if (providerMode() !== "local") {
    if (!process.env.MISTRAL_API_KEY && !process.env.FEATHERLESS_API_KEY) {
      console.warn("[providers] Hosted mode with no MISTRAL_API_KEY: reports will fail. Run offline with PROVIDER_MODE=local (no key needed; docs/setup.md, part 3), or add a key to .env.local.");
    }
    setReady(!!process.env.MISTRAL_API_KEY || !!process.env.FEATHERLESS_API_KEY);
    return;
  }
  console.log("[providers] Offline mode: speech-to-text through Whisper and extraction through Ollama on this computer; no key needed.");
  const { warmUpExtractor } = await import("./lib/providers/extractor");
  const { AREAS } = await import("./lib/geo/areas");
  const { checkLocalTranscriber } = await import("./lib/providers/transcriber");
  // Speech readiness is checked live by /api/health, so a later speech-server start can recover.
  void checkLocalTranscriber();
  void warmUpExtractor(Object.values(AREAS).map((a) => a.place)).then(setReady);
}
