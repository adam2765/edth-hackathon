/**
 * Where the models run.
 *   hosted  (default) Mistral for speech-to-text and extraction
 *   local   nothing leaves this computer: extraction through Ollama, no speech-to-text yet
 */
export type ProviderMode = "hosted" | "local";

export function providerMode(): ProviderMode {
  return process.env.PROVIDER_MODE?.trim().toLowerCase() === "local" ? "local" : "hosted";
}

/** Ollama's address in local mode. */
export function ollamaUrl(): string {
  return (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}
