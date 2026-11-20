// Runs once when the server starts. In local mode it loads the extraction model and each area's
// prompt in the background, so the first report is not the slow one (decision 85). It does not
// wait for that: the server takes requests at once, and an early report queues behind the warm-up.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { providerMode } = await import("./lib/providers/mode");
  if (providerMode() !== "local") return;
  const { warmUpExtractor } = await import("./lib/providers/extractor");
  const { AREAS } = await import("./lib/geo/areas");
  void warmUpExtractor(Object.values(AREAS).map((a) => a.place));
}
