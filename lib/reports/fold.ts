/**
 * Rebuilds the receiver's picture from the log: the mission, where each call sign is, its trail,
 * any open question, and the feed. Pure, so the live view and a replay are the same function, and a
 * replay is the log read up to a moment. The coordinator uses it too, for each unit's last
 * position. Safe to import on the client.
 */
import type { AreaId } from "@/lib/geo/areas";
import type { Candidate, Resolution } from "@/lib/geo/types";
import type { JoinEntry, LogEntry, ReportEntry, StartPoint, UnitPosition } from "./types";

/** One colour per call sign, in the order they first report. Distinct on the light map, each with a label as well. */
export const UNIT_COLOURS = ["#ff6b2c", "#2c7fff", "#16a34a", "#b04ad8", "#e0367a", "#0d9488", "#a16207", "#475569"];

/** A marker dims once its speaker has said nothing for this long. */
export const FADE_AFTER_MS = 3 * 60_000;

const TRAIL_MAX = 30;

export interface Pending {
  reportId: string;
  ts: number;
  question: string;
  candidates: Candidate[];
}

export interface UnitState {
  callsign: string;
  colour: string;
  area: AreaId;
  position: UnitPosition | null;
  /** When the current position was reported. */
  positionTs: number | null;
  /** Earlier positions, oldest first. */
  trail: { lat: number; lon: number; ts: number }[];
  /** Start of the movement arrow, when the current position came from a movement. */
  arrowFrom: { lat: number; lon: number } | null;
  /** Last join, report or answer from this call sign. */
  lastHeard: number;
  pending: Pending | null;
  /** When it joined the mission; null for a call sign that reported without joining (no mission). */
  joined: number | null;
  /** The phone holding the call sign, from its latest join. Null when it joined with its first report. */
  device: string | null;
  /** Still at the start point it was given on joining: an assumption, so it leaves no trail. */
  atStart: boolean;
}

export interface FeedItem {
  /** A report, or a call sign joining. */
  kind: "report" | "join";
  /** The report's or the join's id. */
  id: string;
  ts: number;
  callsign: string;
  colour: string;
  area: AreaId;
  transcript: string;
  status: Resolution["status"];
  outcome: string;
  /** Where the report, or the answer to its question, put the speaker. */
  position: UnitPosition | null;
  /** The choices offered, while a question is open or after it was answered. */
  candidates: Candidate[];
  answer: { ts: number; choice: string | null; name: string | null } | null;
  /** The mission ended while the question was open, so it can no longer be answered. */
  expired: boolean;
}

export interface MissionState {
  name: string;
  area: AreaId;
  start: StartPoint | null;
  opened: number;
  /** When it was ended, if that is within the part of the log read. */
  ended: number | null;
}

export interface SessionState {
  /** Null for a session from before missions. */
  mission: MissionState | null;
  units: UnitState[];
  /** Newest first. */
  feed: FeedItem[];
  /** Time of the first and last entry included. */
  first: number | null;
  last: number | null;
  /** Area of the latest entry included. */
  area: AreaId | null;
}

/** Colours by call sign, from the whole log, so a call sign keeps its colour through a replay. */
export function colourMap(entries: LogEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) {
    if ((e.kind === "report" || e.kind === "join" || e.kind === "answer") && !m.has(e.callsign)) m.set(e.callsign, UNIT_COLOURS[m.size % UNIT_COLOURS.length]);
  }
  return m;
}

export function describePosition(p: UnitPosition): string {
  if (p.heading_to) return `Moved towards ${p.heading_to.name} (±${p.radius_m} m)`;
  return p.estimated ? `Estimated: ${p.label} (±${p.radius_m} m)` : `Placed at ${p.label} (±${p.radius_m} m)`;
}

function joinOutcome(e: JoinEntry, again: boolean): string {
  if (again) return "Joined again from another phone.";
  const how = e.device ? "Joined" : "Joined with its first report";
  return e.position ? `${how}. ${describePosition(e.position)}` : `${how}. Not placed yet: waiting for a check-in.`;
}

function reportOutcome(e: ReportEntry): string {
  const r = e.resolution;
  if (e.position) return describePosition(e.position);
  if (r.status === "resolved") return r.heading_to ? `Heading to ${r.heading_to.name} (no starting position yet)` : "Nothing to place";
  if (r.status === "ambiguous") return `Asked: ${r.question ?? "which one?"}`;
  return r.question ?? "Could not place that.";
}

/** The picture after every entry up to and including `upTo` (epoch ms). */
export function foldLog(entries: LogEntry[], upTo = Number.POSITIVE_INFINITY, colours = colourMap(entries)): SessionState {
  const units = new Map<string, UnitState>();
  const feed = new Map<string, FeedItem>();
  const reports = new Map<string, ReportEntry>();
  let first: number | null = null;
  let last: number | null = null;
  let area: AreaId | null = null;
  let mission: MissionState | null = null;

  const unitFor = (callsign: string, a: AreaId): UnitState => {
    let u = units.get(callsign);
    if (!u) {
      u = { callsign, colour: colours.get(callsign) ?? UNIT_COLOURS[0], area: a, position: null, positionTs: null, trail: [], arrowFrom: null, lastHeard: 0, pending: null, joined: null, device: null, atStart: false };
      units.set(callsign, u);
    }
    return u;
  };

  const move = (u: UnitState, p: UnitPosition, ts: number, from: { lat: number; lon: number } | null) => {
    if (u.position && u.positionTs != null && !u.atStart) u.trail = [...u.trail, { lat: u.position.lat, lon: u.position.lon, ts: u.positionTs }].slice(-TRAIL_MAX);
    u.atStart = false;
    // The arrow starts where the phone said the speaker was; failing that, where the map had them.
    const prev = from ?? u.position;
    const start = prev ? { lat: prev.lat, lon: prev.lon } : null;
    u.position = p;
    u.positionTs = ts;
    u.arrowFrom = p.heading_to ? start : null;
  };

  for (const e of entries) {
    if (e.ts > upTo) continue;
    first ??= e.ts;
    last = e.ts;

    if (e.kind === "mission") {
      mission = { name: e.name, area: e.area, start: e.start, opened: e.ts, ended: null };
      area = e.area;
      continue;
    }

    if (e.kind === "end") {
      if (mission) mission.ended = e.ts;
      // Questions still open can no longer be answered.
      for (const u of units.values()) {
        const item = u.pending ? feed.get(u.pending.reportId) : undefined;
        if (item) {
          item.expired = true;
          item.outcome = `${item.outcome} Not answered before the mission ended.`;
        }
        u.pending = null;
      }
      continue;
    }

    if (e.kind === "join") {
      const u = unitFor(e.callsign, mission?.area ?? area ?? "vincennes");
      const again = u.joined != null;
      u.joined ??= e.ts;
      u.device = e.device;
      u.lastHeard = Math.max(u.lastHeard, e.ts);
      // The start point is only where a unit is assumed to be; it never replaces a real fix.
      if (e.position && !u.position) {
        u.position = e.position;
        u.positionTs = e.ts;
        u.arrowFrom = null;
        u.atStart = true;
      }
      feed.set(e.id, {
        kind: "join",
        id: e.id,
        ts: e.ts,
        callsign: e.callsign,
        colour: u.colour,
        area: u.area,
        transcript: "",
        status: "resolved",
        outcome: joinOutcome(e, again),
        position: again ? null : e.position,
        candidates: [],
        answer: null,
        expired: false,
      });
      continue;
    }

    if (e.kind === "report") {
      reports.set(e.id, e);
      area = e.area;
      const u = unitFor(e.callsign, e.area);
      u.area = e.area;
      u.lastHeard = e.ts;
      const r = e.resolution;
      if (e.position) {
        move(u, e.position, e.ts, e.lastPosition);
        u.pending = null;
      } else if (r.status === "ambiguous") {
        u.pending = { reportId: e.id, ts: e.ts, question: r.question ?? "Which one?", candidates: r.candidates };
      } else if (r.status === "resolved") {
        u.pending = null;
      }
      feed.set(e.id, {
        kind: "report",
        id: e.id,
        ts: e.ts,
        callsign: e.callsign,
        colour: u.colour,
        area: e.area,
        transcript: e.transcript,
        status: r.status,
        outcome: reportOutcome(e),
        position: e.position,
        candidates: r.status === "ambiguous" ? r.candidates : [],
        answer: null,
        expired: false,
      });
      continue;
    }

    // An answer to a question.
    const item = feed.get(e.report_id);
    const u = unitFor(e.callsign, item?.area ?? area ?? "vincennes");
    u.lastHeard = Math.max(u.lastHeard, e.ts);
    if (u.pending?.reportId === e.report_id) u.pending = null;
    const chosen = e.choice ? (item?.candidates.find((c) => c.id === e.choice) ?? null) : null;
    // A newer fix since the question beats a late answer to it.
    const reportTs = item?.ts ?? e.ts;
    if (e.position && (u.positionTs == null || u.positionTs <= reportTs)) {
      move(u, e.position, e.ts, reports.get(e.report_id)?.lastPosition ?? null);
    }
    if (item) {
      item.answer = { ts: e.ts, choice: e.choice, name: chosen?.name ?? null };
      item.position = e.position;
      item.outcome = e.choice ? `Chose ${chosen?.name ?? e.choice}. ${e.position ? describePosition(e.position) : "Nothing to place"}` : "None of the choices was right.";
    }
  }

  return {
    mission,
    units: [...units.values()],
    feed: [...feed.values()].sort((a, b) => b.ts - a.ts),
    first,
    last,
    area,
  };
}
