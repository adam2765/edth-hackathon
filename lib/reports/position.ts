/**
 * Where a report or a tapped choice leaves the speaker. The same rule the phone applies to its own
 * marker (`positionAfter` in transmitter/src/transport.ts and the web page), worked out once on the
 * server and saved in the log, so the command post and a replay only read positions.
 */
import type { Intent, Placement, Resolution } from "@/lib/geo/types";
import type { UnitPosition } from "./types";

const DEFAULT_RADIUS_M = 80;

/**
 * A placement with a pin moves the speaker. A movement with no known start has no pin, so the
 * speaker stays where they were (null: no change).
 */
export function positionFromPlacement(pl: Placement, label: string): UnitPosition | null {
  if (!pl.pin) return null;
  const radius_m = pl.radius_m ?? DEFAULT_RADIUS_M;
  if (pl.heading_to) {
    return { lat: pl.pin.lat, lon: pl.pin.lon, radius_m, label: `towards ${pl.heading_to.name}`, estimated: true, heading_to: pl.heading_to };
  }
  return { lat: pl.pin.lat, lon: pl.pin.lon, radius_m, label, ...(pl.estimated ? { estimated: true } : {}) };
}

/** The name to show for a resolved report: the place it matched, or what a move was worked out from. */
export function labelFor(res: Resolution, intent: Intent | null): string {
  const target = res.candidates.find((c) => c.id === res.evidence.feature_id);
  if (target) return target.name;
  // A grid reference names no place: the grid is the label, "grid DQ 586 101" [228].
  if (res.evidence.rule === "grid_reference") return res.evidence.detail.split(":")[0];
  if (res.estimated && intent?.distance_m) {
    const dir = (intent.direction ?? intent.relation?.replace(/_of$/, "") ?? "").replace("_", "-");
    return `${intent.distance_m} m ${dir} of the last position`.replace(/\s+/g, " ");
  }
  return "position";
}

/** Where a report leaves the speaker. Only a resolved report moves them; a question waits for the answer. */
export function positionFromReport(res: Resolution, intent: Intent | null): UnitPosition | null {
  if (res.status !== "resolved") return null;
  return positionFromPlacement({ pin: res.pin, radius_m: res.radius_m, heading_to: res.heading_to, estimated: res.estimated }, labelFor(res, intent));
}
