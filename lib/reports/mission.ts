/**
 * What a mission's log says about the mission itself: its opening line, whether it has ended, a
 * summary for the list of missions, and where a unit starts. Pure; safe to import on the client.
 */
import { bboxHalfDiagonalM } from "../geo/geo";
import type { GazetteerFeature, LastPosition } from "@/lib/geo/types";
import type { EndEntry, LogEntry, MissionEntry, MissionSummary, StartPoint, UnitPosition } from "./types";

/** The smallest circle a start point gets: units are somewhere around it, not on it. */
export const START_RADIUS_M = 300;

export function missionOf(entries: LogEntry[]): MissionEntry | null {
  return entries.find((e): e is MissionEntry => e.kind === "mission") ?? null;
}

export function endOf(entries: LogEntry[]): EndEntry | null {
  return entries.find((e): e is EndEntry => e.kind === "end") ?? null;
}

/**
 * The call signs a radio report can go to [201]: the roster set when the mission was opened, the
 * ones the operator added, and any that joined from a phone, in that order. Only these: a
 * transcript never adds one.
 */
export function missionRoster(entries: LogEntry[]): string[] {
  const out: string[] = [];
  const add = (c: string) => {
    if (!out.includes(c)) out.push(c);
  };
  for (const e of entries) {
    if (e.kind === "mission") (e.roster ?? []).forEach(add);
    else if (e.kind === "roster" || e.kind === "join") add(e.callsign);
  }
  return out;
}

/** Null when the log has no mission line (a session from before missions). */
export function summarizeMission(code: string, entries: LogEntry[]): MissionSummary | null {
  const m = missionOf(entries);
  if (!m) return null;
  const callsigns = new Set<string>();
  let reports = 0;
  for (const e of entries) {
    if (e.kind === "join" || e.kind === "report") callsigns.add(e.callsign);
    if (e.kind === "report") reports++;
  }
  return {
    code,
    name: m.name,
    area: m.area,
    start: m.start,
    roster: missionRoster(entries),
    opened: m.ts,
    ended: endOf(entries)?.ts ?? null,
    units: callsigns.size,
    reports,
    last: entries.length ? entries[entries.length - 1].ts : m.ts,
  };
}

/** Open missions first, then ended ones; newest first in each. */
export function sortMissions(list: MissionSummary[]): MissionSummary[] {
  return [...list].sort((a, b) => (a.ended == null) !== (b.ended == null) ? (a.ended == null ? -1 : 1) : b.opened - a.opened);
}

/** A gazetteer place as a start point: a circle of 300 m, or the place's own size if larger. */
export function startPointFrom(f: GazetteerFeature): StartPoint {
  const size = f.bbox ? Math.round(bboxHalfDiagonalM(f.bbox)) : 0;
  return { id: f.id, name: f.town ? `${f.name}, ${f.town}` : f.name, category: f.category, lat: f.lat, lon: f.lon, radius_m: Math.max(START_RADIUS_M, size) };
}

/** Where a unit that joins is put: around the start point, as an estimate. */
export function startPosition(start: StartPoint): UnitPosition {
  return { lat: start.lat, lon: start.lon, radius_m: start.radius_m, label: `${start.name} (start point)`, estimated: true };
}

/**
 * A unit's position from the log, in the form the resolver takes. An estimate carries its circle
 * as `uncertainty_m`, so it does not settle a choice between nearby places on its own [47].
 */
export function toLastPosition(p: UnitPosition, ts: number): LastPosition {
  return { lat: p.lat, lon: p.lon, ts, radius_m: p.radius_m, uncertainty_m: p.estimated ? p.radius_m : undefined };
}
