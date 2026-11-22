/**
 * Tracks placed and changed by hand at the command post, and a unit placed by hand [243]: checking
 * what the page sent, where a click or a picked place puts it, how that point is named, and the
 * next track number. Pure, so it is tested without a server. No model is involved anywhere here:
 * the position comes from a person, a click on the map or a place from the gazetteer picked by name.
 */
import { AREAS, type AreaId } from "../geo/areas";
import { bboxHalfDiagonalM, bearingDeg, distanceM, nearestPointOnLines } from "../geo/geo";
import { AFFILIATIONS, TRACK_KINDS } from "../geo/trackKinds";
import type { Affiliation, GazetteerFeature, TrackKind } from "../geo/types";
import { callsignOf, type LogEntry, type PlotAction, type UnitPosition } from "./types";

/** The circles a person can give a track they place, in metres. */
export const PLOT_RADII = [25, 50, 100, 250] as const;
export const PLOT_RADIUS_DEFAULT = 50;
const RADIUS_MIN = 5;
const RADIUS_MAX = 2000;
const COUNT_MAX = 999;
const NOTE_MAX = 120;
/** A click may land a little outside the gazetteer's box, not in another town. */
const AREA_MARGIN_DEG = 0.01;
/** Closer than this to a place, a point is named by the place alone. */
const AT_PLACE_M = 30;
/** A landmark this close is a better name than the street the point is nearest to. */
const LANDMARK_FIRST_M = 200;
/**
 * The most a place's size counts for. A park's box can take in streets of houses, so a click
 * there is measured from near its middle, not from the edge of its box.
 */
const SIZE_CAP_M = 150;
const LINE_CATEGORIES = new Set(["street", "water", "intersection"]);

/** Where a track goes: a point the person clicked, or a gazetteer place picked by name. */
export type PlotWhere = { lat: number; lon: number } | { place: string };

export type PlotInput =
  | { action: "place"; affiliation: Affiliation; track_kind: TrackKind; count: number | null; where: PlotWhere; radius_m: number; note: string | null }
  | { action: "edit"; n: number; affiliation: Affiliation; track_kind: TrackKind; count: number | null; note: string | null }
  | { action: "move"; n: number; where: PlotWhere; radius_m: number; note: string | null }
  | { action: "gone" | "restore"; n: number };

/** The next free track number in a mission: numbers count up and are never reused. */
export function nextTrackNumber(entries: LogEntry[]): number {
  return Math.max(0, ...entries.map((e) => (e.kind === "report" && e.track ? e.track.n : e.kind === "plot" ? e.n : 0))) + 1;
}

type Parsed = { ok: true; input: PlotInput } | { ok: false; error: string };

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}

function parseWhere(body: Record<string, unknown>): PlotWhere | string {
  if (typeof body.place === "string" && body.place.length > 0 && body.place.length <= 200) return { place: body.place };
  const lat = body.lat;
  const lon = body.lon;
  if (typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  return "Send `lat` and `lon` (a point on the map), or `place` (a gazetteer place id).";
}

function parseRadius(v: unknown): number | string {
  if (v == null) return PLOT_RADIUS_DEFAULT;
  if (typeof v !== "number" || !Number.isFinite(v) || v < RADIUS_MIN || v > RADIUS_MAX) return `\`radius_m\` is a number of metres from ${RADIUS_MIN} to ${RADIUS_MAX}.`;
  return Math.round(v);
}

function parseCount(v: unknown): number | null | string {
  if (v == null || v === 1) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > COUNT_MAX) return `\`count\` is a whole number from 1 to ${COUNT_MAX}, or null.`;
  return v;
}

function parseNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return s || null;
}

function parseWhat(body: Record<string, unknown>): { affiliation: Affiliation; track_kind: TrackKind; count: number | null } | string {
  // Whose it is must be said: the page starts on unknown, and nothing is hostile unless chosen.
  const affiliation = oneOf(body.affiliation, AFFILIATIONS);
  if (!affiliation) return `\`affiliation\` is one of: ${AFFILIATIONS.join(", ")}.`;
  const track_kind = oneOf(body.kind, TRACK_KINDS);
  if (!track_kind) return `\`kind\` is one of: ${TRACK_KINDS.join(", ")}.`;
  const count = parseCount(body.count);
  if (typeof count === "string") return count;
  return { affiliation, track_kind, count };
}

/**
 * Checks what the command post sent. `place` for `POST …/tracks`; `n` and an action for
 * `PATCH …/tracks/<n>`. Shapes only: whether the track exists is checked against the log.
 */
export function parsePlot(body: unknown, action: PlotAction, n: number | null): Parsed {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object." };
  const b = body as Record<string, unknown>;
  if (action !== "place" && (n == null || !Number.isInteger(n) || n < 1)) return { ok: false, error: "No such track number." };
  if (action === "gone" || action === "restore") return { ok: true, input: { action, n: n! } };
  const note = parseNote(b.note);
  if (action === "edit") {
    const what = parseWhat(b);
    if (typeof what === "string") return { ok: false, error: what };
    return { ok: true, input: { action, n: n!, ...what, note } };
  }
  const where = parseWhere(b);
  if (typeof where === "string") return { ok: false, error: where };
  const radius_m = parseRadius(b.radius_m);
  if (typeof radius_m === "string") return { ok: false, error: radius_m };
  if (action === "move") return { ok: true, input: { action, n: n!, where, radius_m, note } };
  const what = parseWhat(b);
  if (typeof what === "string") return { ok: false, error: what };
  return { ok: true, input: { action: "place", ...what, where, radius_m, note } };
}

/** A unit placed by hand [243]: which unit, where, how sure, and where the information came from. */
export type FixInput = { callsign: string; where: PlotWhere; radius_m: number; note: string | null };

/**
 * Checks what the command post sent to `POST /api/sessions/<code>/units/position`: a call sign, and
 * a point or a place as for a track. Shapes only: whether the unit is on the roster is checked
 * against the log.
 */
export function parseFix(body: unknown): { ok: true; input: FixInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object." };
  const b = body as Record<string, unknown>;
  if (typeof b.callsign !== "string" || !b.callsign.trim()) return { ok: false, error: "Send `callsign`: the unit." };
  const where = parseWhere(b);
  if (typeof where === "string") return { ok: false, error: where };
  const radius_m = parseRadius(b.radius_m);
  if (typeof radius_m === "string") return { ok: false, error: radius_m };
  return { ok: true, input: { callsign: callsignOf(b.callsign), where, radius_m, note: parseNote(b.note) } };
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

function featureName(f: GazetteerFeature): string {
  return f.town ? `${f.name}, ${f.town}` : f.name;
}

/** How far a point is from a place's edge, and the point on the place it is measured from. */
function edgeDistance(p: { lat: number; lon: number }, f: GazetteerFeature): { d: number; from: { lat: number; lon: number } } {
  if (f.lines?.length) {
    const q = nearestPointOnLines(p, f.lines);
    return { d: distanceM(p, q), from: q };
  }
  const size = f.bbox ? Math.min(SIZE_CAP_M, bboxHalfDiagonalM(f.bbox)) : 0;
  return { d: Math.max(0, distanceM(p, f) - size), from: { lat: f.lat, lon: f.lon } };
}

/**
 * How the command post names a point it placed a track at: the place itself when the point is on
 * it ("Château de Vincennes"), otherwise a distance and a compass direction from the nearest place
 * ("120 m north-east of Château de Vincennes"). A landmark within 200 m is preferred to a street,
 * because the person at the base knows the landmarks. Worked out in code from the gazetteer.
 */
export function pointLabel(p: { lat: number; lon: number }, features: GazetteerFeature[]): string {
  type Near = { f: GazetteerFeature; d: number; from: { lat: number; lon: number } };
  let any: Near | null = null;
  let landmark: Near | null = null;
  for (const f of features) {
    if (!f.name) continue;
    const e = { f, ...edgeDistance(p, f) };
    if (!any || e.d < any.d) any = e;
    if (!LINE_CATEGORIES.has(f.category) && (!landmark || e.d < landmark.d)) landmark = e;
  }
  const best = landmark && landmark.d <= LANDMARK_FIRST_M && !(any && any.d <= AT_PLACE_M && any.d < landmark.d) ? landmark : any;
  if (!best) return "a point on the map";
  if (best.d <= AT_PLACE_M) return featureName(best.f);
  const metres = Math.round(distanceM(best.from, p) / 10) * 10;
  const far = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`;
  const dir = COMPASS[Math.round(bearingDeg(best.from, p) / 45) % 8];
  return `${far} ${dir} of ${featureName(best.f)}`;
}

/** True when a point is in the area, or a short way outside its box. */
export function inArea(p: { lat: number; lon: number }, area: AreaId): boolean {
  const b = AREAS[area].bbox;
  return p.lat >= b.s - AREA_MARGIN_DEG && p.lat <= b.n + AREA_MARGIN_DEG && p.lon >= b.w - AREA_MARGIN_DEG && p.lon <= b.e + AREA_MARGIN_DEG;
}

/**
 * Where a placed or moved track goes. A picked place: its own point, with a circle of at least
 * the place's size. A click: the point, named after the nearest place. Errors are for the person.
 */
export function plotPosition(where: PlotWhere, radius_m: number, area: AreaId, features: GazetteerFeature[]): UnitPosition | string {
  if ("place" in where) {
    const f = features.find((x) => x.id === where.place);
    if (!f) return "No place with that id in this mission's area.";
    const size = f.bbox ? Math.round(bboxHalfDiagonalM(f.bbox)) : 0;
    return { lat: f.lat, lon: f.lon, radius_m: Math.max(radius_m, size), label: featureName(f) };
  }
  if (!inArea(where, area)) return `That point is outside ${AREAS[area].label}, this mission's area.`;
  return { lat: Math.round(where.lat * 1e6) / 1e6, lon: Math.round(where.lon * 1e6) / 1e6, radius_m, label: pointLabel(where, features) };
}
