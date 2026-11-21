/**
 * Rebuilds the receiver's picture from the log: the mission, where each call sign is, its trail,
 * any open question, and the feed. Pure, so the live view and a replay are the same function, and a
 * replay is the log read up to a moment. The coordinator uses it too, for each unit's last
 * position. Safe to import on the client.
 */
import type { AreaId } from "@/lib/geo/areas";
import type { Affiliation, Candidate, Direction, Resolution, TrackKind } from "@/lib/geo/types";
import { bearingDeg, distanceM } from "../geo/geo";
import { describeTrack } from "../geo/trackKinds";
import type { JoinEntry, LogEntry, ReportEntry, StartPoint, TrackSighting, UnitPosition } from "./types";

/** One colour per call sign, in the order they first report. Distinct on the light map, each with a label as well. */
export const UNIT_COLOURS = ["#ff6b2c", "#2c7fff", "#16a34a", "#b04ad8", "#e0367a", "#0d9488", "#a16207", "#475569"];

/** A marker dims once its speaker has said nothing for this long. */
export const FADE_AFTER_MS = 3 * 60_000;

/**
 * A track is shown as old once nobody has reported it for this long. Longer than a unit's silence:
 * a unit is expected to report, a track is only seen when someone looks.
 */
export const TRACK_OLD_AFTER_MS = 10 * 60_000;

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
  /** Last join, report or answer from this call sign. */
  lastHeard: number;
  pending: Pending | null;
  /** When it joined the mission; null for a call sign that reported without joining (no mission). */
  joined: number | null;
  /** The phone holding the call sign, from its latest join. Null when it joined with its first report. */
  device: string | null;
  /** Still at the start point it was given on joining: an assumption, so it leaves no trail. */
  atStart: boolean;
  /** The street it is on or moving along, when its latest placement named one (a gazetteer id). */
  street: string | null;
}

/**
 * A track: something on the map that is not a reporting unit, as the reports about it leave it.
 * What it is comes from the latest report that said so; where it is, from the latest sighting.
 */
export interface TrackState {
  /** Its number in the mission ("Track 3"). */
  n: number;
  /** Whose it is. `unknown` until a report says. */
  affiliation: Affiliation;
  kind: TrackKind;
  count: number | null;
  /** The thing as last said. */
  text: string | null;
  /** The way it was moving at its latest sighting, when that was said. */
  heading: Direction | null;
  area: AreaId;
  /** Null while the first report's question about where it is still waits. */
  position: UnitPosition | null;
  positionTs: number | null;
  /** Earlier sightings, oldest first. */
  trail: { lat: number; lon: number; ts: number }[];
  /** Who reported it last, and when. */
  seenBy: string;
  seenTs: number;
  /** Where the observer was at the latest sighting, for the line of sight. */
  from: { lat: number; lon: number } | null;
  openedBy: string;
  openedTs: number;
  /** The report whose question about where the track is still waits for an answer. */
  pendingReport: string | null;
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
  /** Where the report, or the answer to its question, put the speaker, or the track it was about. */
  position: UnitPosition | null;
  /** The number of the track the report was about; null for a report about the speaker. */
  track: number | null;
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
  /** By number. */
  tracks: TrackState[];
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

/** "±80 m", with "estimated" in front for a place worked out from where the observer was. */
function trackWhere(p: UnitPosition): string {
  return `${p.estimated ? "estimated " : "at "}${p.label} (±${p.radius_m} m)`;
}

/** What a report did to a track, in words, once the track has taken it in. */
function trackOutcome(e: ReportEntry, s: TrackSighting, t: TrackState, opened: boolean): string {
  const what = describeTrack(t);
  if (e.resolution.status === "ambiguous") return `Asked: ${e.resolution.question ?? "which one?"}`;
  if (opened) return s.position ? `Marked Track ${t.n}: ${what} ${trackWhere(s.position)}` : `Marked Track ${t.n}: ${what}. Not placed yet.`;
  if (s.position) return `Track ${t.n} now ${trackWhere(s.position)}`;
  return `Track ${t.n} is now: ${what}`;
}

function reportOutcome(e: ReportEntry): string {
  const r = e.resolution;
  if (e.position) return describePosition(e.position);
  if (r.status === "resolved") return r.heading_to ? `Heading to ${r.heading_to.name} (no starting position yet)` : "Nothing to place";
  if (r.status === "ambiguous") return `Asked: ${r.question ?? "which one?"}`;
  return r.question ?? "Could not place that.";
}

/**
 * The street a placement leaves a unit on: a street it was placed on or sent along, kept through a
 * crossing on that street. Anything else (a church, a move by compass) says nothing about a street.
 */
function streetAfter(before: string | null, c: Candidate | undefined): string | null {
  if (c?.category === "street") return c.id;
  if (c?.category === "intersection" && before && c.streets?.includes(before)) return before;
  return null;
}

/** Fixes closer together than this say nothing about which way the unit is going. */
const HEADING_MIN_M = 15;

/** The bearing a unit moved on from its previous fix to its current one; null when unknown. */
export function headingOf(u: UnitState): number | null {
  const prev = u.trail.at(-1);
  if (!u.position || !prev || u.atStart) return null;
  if (distanceM(prev, u.position) < HEADING_MIN_M) return null;
  return Math.round(bearingDeg(prev, u.position));
}

/** The picture after every entry up to and including `upTo` (epoch ms). */
export function foldLog(entries: LogEntry[], upTo = Number.POSITIVE_INFINITY, colours = colourMap(entries)): SessionState {
  const units = new Map<string, UnitState>();
  const tracks = new Map<number, TrackState>();
  const feed = new Map<string, FeedItem>();
  let first: number | null = null;
  let last: number | null = null;
  let area: AreaId | null = null;
  let mission: MissionState | null = null;

  const unitFor = (callsign: string, a: AreaId): UnitState => {
    let u = units.get(callsign);
    if (!u) {
      u = { callsign, colour: colours.get(callsign) ?? UNIT_COLOURS[0], area: a, position: null, positionTs: null, trail: [], lastHeard: 0, pending: null, joined: null, device: null, atStart: false, street: null };
      units.set(callsign, u);
    }
    return u;
  };

  const move = (u: UnitState, p: UnitPosition, ts: number) => {
    if (u.position && u.positionTs != null && !u.atStart) u.trail = [...u.trail, { lat: u.position.lat, lon: u.position.lon, ts: u.positionTs }].slice(-TRAIL_MAX);
    u.atStart = false;
    u.position = p;
    u.positionTs = ts;
  };

  const placeTrack = (t: TrackState, p: UnitPosition, ts: number) => {
    if (t.position && t.positionTs != null) t.trail = [...t.trail, { lat: t.position.lat, lon: t.position.lon, ts: t.positionTs }].slice(-TRAIL_MAX);
    t.position = p;
    t.positionTs = ts;
    t.pendingReport = null;
  };

  /** Takes a report about a track in. Returns the track, and whether this report opened it. */
  const seeTrack = (e: ReportEntry, s: TrackSighting): { track: TrackState; opened: boolean } => {
    let t = tracks.get(s.n);
    const opened = !t;
    if (!t) {
      t = {
        n: s.n,
        // Nothing is hostile until a speaker says so.
        affiliation: s.affiliation ?? "unknown",
        kind: s.kind ?? "other",
        count: s.count,
        text: s.text,
        heading: null,
        area: e.area,
        position: null,
        positionTs: null,
        trail: [],
        seenBy: e.callsign,
        seenTs: e.ts,
        from: null,
        openedBy: e.callsign,
        openedTs: e.ts,
        pendingReport: null,
      };
      tracks.set(s.n, t);
    } else {
      if (s.affiliation) t.affiliation = s.affiliation;
      if (s.kind) t.kind = s.kind;
      if (s.count) t.count = s.count;
      if (s.text) t.text = s.text;
      t.seenBy = e.callsign;
      t.seenTs = e.ts;
    }
    if (s.position) {
      placeTrack(t, s.position, e.ts);
      // The way it was moving belongs to the sighting: an older one says nothing about now.
      t.heading = s.heading;
      t.from = s.from;
    } else if (e.resolution.status === "ambiguous") {
      t.pendingReport = e.id;
      t.heading = s.heading;
      t.from = s.from;
    } else if (s.heading) t.heading = s.heading;
    return { track: t, opened };
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
      for (const t of tracks.values()) t.pendingReport = null;
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
        u.atStart = true;
        u.street = mission?.start?.category === "street" ? mission.start.id : null;
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
        track: null,
      });
      continue;
    }

    if (e.kind === "report") {
      area = e.area;
      const u = unitFor(e.callsign, e.area);
      u.area = e.area;
      u.lastHeard = e.ts;
      const r = e.resolution;
      // A report about a track: the unit was heard, and does not move. It owes the answer to any question.
      const seen = e.track ? seeTrack(e, e.track) : null;
      if (e.position && !seen) {
        move(u, e.position, e.ts);
        u.street = streetAfter(u.street, r.candidates.find((c) => c.id === r.evidence.feature_id));
        u.pending = null;
      } else if (r.status === "ambiguous") {
        u.pending = { reportId: e.id, ts: e.ts, question: r.question ?? "Which one?", candidates: r.candidates };
      } else if (r.status === "resolved" && !seen) {
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
        outcome: seen && e.track ? trackOutcome(e, e.track, seen.track, seen.opened) : reportOutcome(e),
        position: seen ? (e.track?.position ?? null) : e.position,
        candidates: r.status === "ambiguous" ? r.candidates : [],
        answer: null,
        expired: false,
        track: seen ? seen.track.n : null,
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
    if (e.track) {
      // The answer places the track; the speaker stays where they are.
      const t = tracks.get(e.track.n);
      const p = e.track.position;
      if (t?.pendingReport === e.report_id) t.pendingReport = null;
      if (t && p && (t.positionTs == null || t.positionTs <= reportTs)) placeTrack(t, p, e.ts);
      if (item) {
        item.answer = { ts: e.ts, choice: e.choice, name: chosen?.name ?? null };
        item.position = p;
        item.outcome = e.choice ? `Chose ${chosen?.name ?? e.choice}. ${p ? `Track ${e.track.n} ${trackWhere(p)}` : "Nothing to place"}` : `None of the choices was right. Track ${e.track.n} is not placed.`;
      }
      continue;
    }
    if (e.position && (u.positionTs == null || u.positionTs <= reportTs)) {
      move(u, e.position, e.ts);
      u.street = streetAfter(u.street, chosen ?? undefined);
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
    tracks: [...tracks.values()].sort((a, b) => a.n - b.n),
    feed: [...feed.values()].sort((a, b) => b.ts - a.ts),
    first,
    last,
    area,
  };
}
