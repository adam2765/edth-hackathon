/**
 * Which base map the coordinator prefers. Server only: it reads the environment.
 *
 *   BASEMAP=local    the map saved on this computer (npm run basemap)
 *   BASEMAP=hosted   OpenFreeMap, from the internet
 *
 * With BASEMAP unset it follows the models: saved in offline mode (PROVIDER_MODE=local), hosted otherwise.
 */
import { providerMode } from "@/lib/providers/mode";
import type { BaseMapPreference } from "./baseMap";

export function baseMapPreference(): BaseMapPreference {
  const said = process.env.BASEMAP?.trim().toLowerCase();
  if (said === "local" || said === "hosted") return said;
  return providerMode() === "local" ? "local" : "hosted";
}
