import { requireOptionalNativeModule } from "expo";

/** A coordinator the phone found on the local network: its advert's name, its id, and URLs to try. */
export interface NearbyHost { name: string; id: string; urls: string[] }

// iOS and Android (modules/coordinator-search). Optional, so builds made before it still run:
// they find coordinators through the addresses they already know.
const search = requireOptionalNativeModule<{
  start(): void;
  found(): Promise<{ services: NearbyHost[]; error: string }>;
}>("CoordinatorSearch");

let started = false;
/** What the last scan found, so the log line comes only when it changes. */
let lastSeen = "";

/** The URLs of every coordinator the phone has found by itself (Bonjour, `_voicetomap._tcp`). */
export async function searchNearby(): Promise<string[]> {
  if (!search) return [];
  try {
    if (!started) { search.start(); started = true; }
    const { services, error } = await search.found();
    const seen = JSON.stringify({ services, error });
    if (seen !== lastSeen) { lastSeen = seen; console.log("[search]", seen); }
    return services.flatMap((s) => s.urls);
  } catch {
    return [];
  }
}
