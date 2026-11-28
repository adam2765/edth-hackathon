/**
 * The observer geometry a track sighting keeps: where the observer was, how sure it was of that
 * place, and the bearing as it was said. Additive only: old log entries have none of it, and
 * nothing places a track from these fields yet.
 */
import { bearingSaid, clockSaid } from "../geo/clock";
import type { Direction, Intent, LastPosition } from "../geo/types";

export type TrackBearingSource = "degrees" | "mils" | "clock" | "compass8";

export interface SightingGeometry {
  from: { lat: number; lon: number; radius_m: number } | null;
  bearing_deg: number | null;
  bearing_source: TrackBearingSource | null;
}

const DIRECTION_DEG: Record<Direction, number> = {
  north: 0,
  north_east: 45,
  east: 90,
  south_east: 135,
  south: 180,
  south_west: 225,
  west: 270,
  north_west: 315,
};

/**
 * Read the geometry once, when the report is saved. A clock or a stated bearing wins, as it does
 * for placement; with neither, the compass word's bin centre is kept and named `compass8`.
 */
export function sightingGeometry(
  transcript: string,
  intent: Intent | null,
  last: LastPosition | null | undefined,
): SightingGeometry {
  const from = last ? { lat: last.lat, lon: last.lon, radius_m: Math.round(last.radius_m ?? last.uncertainty_m ?? 0) } : null;
  const clock = clockSaid(transcript);
  const bearing = clock ?? bearingSaid(transcript);
  if (clock) return { from, bearing_deg: clock.deg, bearing_source: "clock" };
  if (bearing) return { from, bearing_deg: bearing.deg, bearing_source: bearing.source ?? "degrees" };
  const relation = intent?.relation && /_of$/.test(intent.relation) ? intent.relation.replace(/_of$/, "") : null;
  const direction = (intent?.direction ?? (relation as Direction | null)) ?? null;
  return {
    from,
    bearing_deg: direction ? DIRECTION_DEG[direction] : null,
    bearing_source: direction ? "compass8" : null,
  };
}
