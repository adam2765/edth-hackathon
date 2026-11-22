// Plain JavaScript with JSDoc types, so the web app's tests (tests/hosts.test.ts) can load it in CI,
// where the transmitter's packages, and so its TypeScript config, are not installed.

/**
 * The coordinator the person connected to, found at a new address: nothing answers at the old one
 * any more, but a ready host with the same id does (the computer moved network or was renamed).
 * @param {import("./hosts").FoundHost[]} found
 * @param {string} serverUrl
 * @param {string | null} connectedId
 * @returns {import("./hosts").FoundHost | undefined}
 */
export function movedTo(found, serverUrl, connectedId) {
  if (!connectedId || found.some((h) => h.url === serverUrl)) return undefined;
  return found.find((h) => h.id === connectedId && h.ready);
}
