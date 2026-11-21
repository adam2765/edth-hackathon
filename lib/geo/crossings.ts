/**
 * Street crossings, worked out from the gazetteer's street lines. In OpenStreetMap two streets that
 * meet share a point, and the gazetteer keeps every point of every street, so a point on two or
 * more named streets is a crossing. A bridge over a street shares no point with it, so it is not one.
 * Pure: the same gazetteer always gives the same crossings, worked out once and kept.
 */
import type { GazetteerFeature } from "./types";
import { bearingDeg, distanceM, round6, type LatLon } from "./geo";

/** Shared points this close together are one crossing: a dual carriageway meets a street at two or four points. */
export const CROSSING_CLUSTER_M = 30;

export interface Crossing {
  /** "crossing/<lat>,<lon>": a pair of streets can cross twice, so the place is the id. */
  id: string;
  lat: number;
  lon: number;
  /** Ids of the streets that meet here. */
  streets: string[];
  /** Their names, in the same order. */
  names: string[];
}

const cache = new WeakMap<GazetteerFeature[], Crossing[]>();

export function crossingsOf(gazetteer: GazetteerFeature[]): Crossing[] {
  const hit = cache.get(gazetteer);
  if (hit) return hit;

  const byId = new Map<string, GazetteerFeature>();
  const at = new Map<string, Set<string>>();
  for (const f of gazetteer) {
    if (f.category !== "street" || !f.lines?.length) continue;
    byId.set(f.id, f);
    for (const line of f.lines) {
      for (const [lon, lat] of line) {
        const k = `${lon},${lat}`;
        let s = at.get(k);
        if (!s) at.set(k, (s = new Set()));
        s.add(f.id);
      }
    }
  }

  // Shared points, grouped: each joins the first group whose middle is within CROSSING_CLUSTER_M.
  // A grid of about 100 m cells keeps the search to the neighbouring cells.
  type Group = { lat: number; lon: number; n: number; streets: Set<string> };
  const groups: Group[] = [];
  const grid = new Map<string, Group[]>();
  const cell = (lat: number, lon: number) => [Math.floor(lat / 0.001), Math.floor(lon / 0.0014)];
  for (const [k, ids] of at) {
    if (ids.size < 2) continue;
    const [lon, lat] = k.split(",").map(Number);
    const [cy, cx] = cell(lat, lon);
    let home: Group | undefined;
    for (let dy = -1; dy <= 1 && !home; dy++) {
      for (let dx = -1; dx <= 1 && !home; dx++) {
        home = grid.get(`${cy + dy},${cx + dx}`)?.find((g) => distanceM(g, { lat, lon }) <= CROSSING_CLUSTER_M);
      }
    }
    if (home) {
      home.lat = (home.lat * home.n + lat) / (home.n + 1);
      home.lon = (home.lon * home.n + lon) / (home.n + 1);
      home.n++;
      for (const id of ids) home.streets.add(id);
    } else {
      const g: Group = { lat, lon, n: 1, streets: new Set(ids) };
      groups.push(g);
      const key = `${cy},${cx}`;
      grid.set(key, [...(grid.get(key) ?? []), g]);
    }
  }

  const out: Crossing[] = [];
  for (const g of groups) {
    const streets = [...g.streets].sort();
    const names: string[] = [];
    for (const id of streets) {
      const n = byId.get(id)!.name;
      if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    // Two streets of one name meeting (a street split at a town border) is not a crossing anyone would name.
    if (names.length < 2) continue;
    const lat = round6(g.lat);
    const lon = round6(g.lon);
    out.push({ id: `crossing/${lat},${lon}`, lat, lon, streets, names: streets.map((id) => byId.get(id)!.name) });
  }
  cache.set(gazetteer, out);
  return out;
}

/** The crossing's name with the street the speaker is on first: "Avenue de Nogent / Rue de Fontenay". */
export function crossingName(c: Crossing, onStreet?: string | null): string {
  const order = c.streets.map((id, i) => ({ id, name: c.names[i] })).sort((a, b) => Number(b.id === onStreet) - Number(a.id === onStreet));
  const names: string[] = [];
  for (const { name } of order) if (!names.some((x) => x.toLowerCase() === name.toLowerCase())) names.push(name);
  return names.join(" / ");
}

/** The names of the other streets at a crossing, for a question asked on one street: "Rue de Fontenay". */
export function crossStreets(c: Crossing, onStreet: string): string {
  const own = c.names[c.streets.indexOf(onStreet)]?.toLowerCase();
  const names: string[] = [];
  for (const [i, id] of c.streets.entries()) {
    const n = c.names[i];
    if (id !== onStreet && n.toLowerCase() !== own && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return names.join(" / ");
}

/** Smallest angle between two bearings, 0 to 180 degrees. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Which way a street runs at the point on it nearest `p`: a bearing from 0 to 180 (it runs both ways). */
export function streetAxisAt(p: LatLon, lines: [number, number][][]): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  const kx = Math.cos((p.lat * Math.PI) / 180);
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = { lon: line[i][0], lat: line[i][1] };
      const b = { lon: line[i + 1][0], lat: line[i + 1][1] };
      const dx = (b.lon - a.lon) * kx;
      const dy = b.lat - a.lat;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, (((p.lon - a.lon) * kx) * dx + (p.lat - a.lat) * dy) / len2));
      const d = ((p.lon - a.lon) * kx - t * dx) ** 2 + (p.lat - a.lat - t * dy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = bearingDeg(a, b) % 180;
      }
    }
  }
  return best;
}
