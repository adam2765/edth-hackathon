// The choices behind `npm run phones`, kept apart from devicectl and Expo so tests can check them.
// The script itself is phones.mjs; why it works this way is decision 199.

/**
 * @typedef {{ name: string, udid: string, connected: boolean, paired: boolean, developerMode?: string }} Phone
 * @typedef {{ name: string, native: string, installedAt: string }} Install
 * @typedef {{ prebuilt?: string, phones?: Record<string, Install> }} State
 * @typedef {{ phone: Phone, action: "install" | "open" | "skip", reason: string, days?: number }} Step
 */

/** A free Apple ID signs an app for 7 days; warn a day before. */
export const SIGNING_WARN_DAYS = 6;

/**
 * What one run does: whether to make the native project again, and what to do on each phone.
 * `native` is the fingerprint of everything that goes into the native build now; `state` is what
 * the last runs recorded; `installed` says which phones have the app at all.
 *
 * @param {{ native: string, state: State, hasNativeProject: boolean, rebuild: boolean, phones: Phone[], installed: Record<string, boolean>, now: Date }} input
 * @returns {{ prebuild: string | null, steps: Step[] }}
 */
export function planPhones({ native, state, hasNativeProject, rebuild, phones, installed, now }) {
  const prebuild = !hasNativeProject
    ? "there is no ios/ folder yet"
    : state.prebuilt === undefined
      ? "the first run of this script makes ios/ again from the config"
      : state.prebuilt !== native
        ? "the native side changed since the last build"
        : null;

  /** @type {Step[]} */
  const steps = phones.map((phone) => {
    if (!phone.connected) return { phone, action: "skip", reason: "not connected: plug it in, or put it on the same network as this Mac" };
    if (!phone.paired) return { phone, action: "skip", reason: "not trusted yet: unlock it and tap Trust" };
    if (phone.developerMode !== "enabled") {
      return { phone, action: "skip", reason: "Developer Mode is off: Settings → Privacy & Security → Developer Mode" };
    }
    const record = state.phones?.[phone.udid];
    if (prebuild) return { phone, action: "install", reason: prebuild };
    if (rebuild) return { phone, action: "install", reason: "--rebuild" };
    if (!installed[phone.udid]) return { phone, action: "install", reason: "the app is not on it yet" };
    if (!record || record.native !== native) return { phone, action: "install", reason: "its copy may be from an older native build" };
    const days = Math.floor((now.getTime() - Date.parse(record.installedAt)) / 86_400_000);
    return { phone, action: "open", reason: "native side unchanged", days };
  });

  return { prebuild: steps.some((s) => s.action === "install") ? prebuild : null, steps };
}
