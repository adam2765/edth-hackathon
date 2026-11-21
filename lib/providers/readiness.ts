// Runtime readiness shared across the instrumentation and route bundles in one Node process.
const runtime = globalThis as typeof globalThis & { voiceReady?: boolean };
export function setReady(ready: boolean) { runtime.voiceReady = ready; }
export function isReady() { return runtime.voiceReady === true; }
