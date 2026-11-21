/**
 * A cone for a thing placed by a way and a distance from the one who saw it [233]: "contact,
 * bearing 060, 300 metres", "two vehicles 300 m north-east of me". The error of such a place is
 * mostly in the angle, so the command post draws a sector from the observer instead of a circle:
 * as wide across as the circle, and as deep, on the line of sight. Pure.
 */
import { bearingDeg, destination, distanceM, type LatLon } from "./geo";

/** True for a label the resolver gives a track placed from its observer: "300 m north-east of ALPHA 1", "300 m, bearing 060, from ALPHA 1". A grid is a place of its own, not the observer. */
export function placedFromObserver(label: string): boolean {
  return /^\d+ m\b/.test(label) && /\b(of|from) /.test(label) && !/\bgrid\b/.test(label);
}

/**
 * The ring of a sector from `from` towards `to`: the circle of radius `radiusM` around `to`, seen
 * from `from`, from d - r to d + r deep and as wide as the circle across. Null when the observer
 * is inside the circle, where a cone means nothing; then the circle stays.
 */
export function sectorRing(from: LatLon, to: LatLon, radiusM: number): [number, number][] | null {
  const d = distanceM(from, to);
  if (d <= radiusM * 1.2) return null;
  const b = bearingDeg(from, to);
  const half = (Math.asin(Math.min(1, radiusM / d)) * 180) / Math.PI;
  const near = d - radiusM;
  const far = d + radiusM;
  const steps = 24;
  const arc = (r: number, a0: number, a1: number) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const p = destination(from, a0 + ((a1 - a0) * i) / steps, r);
      return [p.lon, p.lat] as [number, number];
    });
  const ring = [...arc(far, b - half, b + half), ...arc(near, b + half, b - half)];
  ring.push(ring[0]);
  return ring;
}
