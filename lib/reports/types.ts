/**
 * The shared record: a mission's opening, every unit that joins, every report and every answer to
 * a question, what the command post did to a track by hand, and the mission's end, as one
 * append-only log per session. The coordinator writes it; the command post reads it and rebuilds
 * the map from it, live or up to any moment for a replay.
 * A mission is what the code calls a session: one code, one log. Safe to import on the client.
 */
// Relative, not "@/", so the transmitter can import these types too (decision 67).
import type { AreaId } from "../geo/areas";
import type { Affiliation, Direction, HeadingTo, Intent, LastPosition, Resolution, TrackKind } from "../geo/types";

export type Timings = { stt: number; extract: number; resolve: number; total: number };

/** Where a report leaves the speaker. */
export interface UnitPosition {
  lat: number;
  lon: number;
  radius_m: number;
  /** What the position was placed at, for the marker and the feed ("Bérault", "towards Château de Vincennes"). */
  label: string;
  /** Worked out from the last position and a movement, not from a stated position. Shown with ≈. */
  estimated?: boolean;
  /** For a movement: where the speaker is heading. */
  heading_to?: HeadingTo;
}

/**
 * What a report says about a track, something on the map that is not a reporting unit: a first
 * sighting, a later one, or only a change to what it is. For reconnaissance: it keeps who saw it,
 * from where, and how sure the place is.
 */
export interface TrackSighting {
  /** The track's number in this mission, given by the coordinator. A number is never reused. */
  n: number;
  /** Whose it is, as said in this report; null when the report had no word for it. */
  affiliation: Affiliation | null;
  kind: TrackKind | null;
  count: number | null;
  /** The thing as said ("two armoured vehicles"). */
  text: string | null;
  /** The way it is moving, as said. */
  heading: Direction | null;
  /** Where the report puts the track; null while its question is open, or when it only says what the track is. */
  position: UnitPosition | null;
  /** Where the observer was, for the line of sight on the map; null when not known. */
  from: { lat: number; lon: number } | null;
}

export interface ReportEntry {
  kind: "report";
  id: string;
  session: string;
  callsign: string;
  /** The transmitter's own counter; with clientTs it spots a report sent twice. */
  seq: number | null;
  /** Server time when the report was saved, epoch ms. The command post orders and replays by this. */
  ts: number;
  clientTs: number | null;
  area: AreaId;
  transcript: string;
  language: string | null;
  intent: Intent | null;
  resolution: Resolution;
  /** The last position the transmitter sent with the report: the start of a movement arrow. */
  lastPosition: LastPosition | null;
  /** Where the report puts the speaker; null when it does not move them (a question, could not place, a track). */
  position: UnitPosition | null;
  /** Set when the report is about a track. `position` is then null: the speaker does not move. */
  track?: TrackSighting | null;
  timings_ms: Timings;
}

export interface AnswerEntry {
  kind: "answer";
  id: string;
  session: string;
  callsign: string;
  ts: number;
  /** The report whose question this answers. */
  report_id: string;
  /** The candidate tapped, or null for "none of these". */
  choice: string | null;
  position: UnitPosition | null;
  /** For a question about a track: where the choice puts the track. `position` is then null. */
  track?: { n: number; position: UnitPosition | null } | null;
  /**
   * Set when the command post chose for the unit ("CP"), as when reports come by radio and nobody
   * can tap. Absent when the unit answered itself. The unit was not heard.
   */
  by?: string;
}

/** The name the command post writes under in the log. One for now: there are no logins. */
export const COMMAND_POST = "CP";

/** What the command post can do to a track by hand. */
export type PlotAction = "place" | "edit" | "move" | "gone" | "restore";

/**
 * What a person at the command post did to a track by hand: placed a new one, changed whose or
 * what it is, moved it, marked it gone, or brought it back. Never written by a model. A track
 * placed here gets its number from the same count as a reported one, so a unit can then say
 * "Track 7 moved to the station".
 */
export interface PlotEntry {
  kind: "plot";
  id: string;
  session: string;
  ts: number;
  /** Who did it: "CP". */
  by: string;
  action: PlotAction;
  /** The track's number. */
  n: number;
  /** For `place` and `edit`: whose it is, chosen by the person, never assumed. */
  affiliation?: Affiliation;
  /** For `place` and `edit`: what it is. */
  track_kind?: TrackKind;
  /** For `place` and `edit`: how many; null when not counted. */
  count?: number | null;
  /** For `place` and `move`: a point the person clicked, or a place they picked by name. */
  position?: UnitPosition;
  /** Where the information came from, as typed ("drone feed", "BRAVO 2 by phone"). */
  note?: string | null;
}

/** A place from the gazetteer where units are assumed to be when they join. Picked at the base, never by the model. */
export interface StartPoint {
  /** The gazetteer feature's id. */
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  /** 300 m, or the place's own size if larger. */
  radius_m: number;
}

/** The first line of a mission's log. */
export interface MissionEntry {
  kind: "mission";
  id: string;
  session: string;
  ts: number;
  area: AreaId;
  name: string;
  start: StartPoint | null;
}

/** A call sign joins the mission. */
export interface JoinEntry {
  kind: "join";
  id: string;
  session: string;
  callsign: string;
  ts: number;
  /** The phone's own id, kept on the phone. Null when the call sign joined with its first report. */
  device: string | null;
  /** Where the unit starts: the start point as an estimate, or null (not placed yet). */
  position: UnitPosition | null;
}

/** The mission is ended: no more joins, reports or answers. The log stays for replay. */
export interface EndEntry {
  kind: "end";
  id: string;
  session: string;
  ts: number;
}

export type LogEntry = MissionEntry | JoinEntry | EndEntry | ReportEntry | AnswerEntry | PlotEntry;

/** One mission as listed by `GET /api/sessions` and returned when one is opened, joined or ended. */
export interface MissionSummary {
  code: string;
  name: string;
  area: AreaId;
  start: StartPoint | null;
  opened: number;
  /** When it was ended; null while open. */
  ended: number | null;
  /** Call signs that joined or reported. */
  units: number;
  reports: number;
  /** Time of the latest entry. */
  last: number;
}

/** `GET /api/sessions` */
export interface MissionListReply {
  /** False when this coordinator keeps no record (for now, the hosted site): there are no missions to join. */
  stored: boolean;
  /** Open missions first, newest first; then ended ones, newest first. */
  missions: MissionSummary[];
}

/** `GET /api/places?area=&q=`: places to pick a start point from, each as the start point it would make. */
export interface PlacesReply {
  places: StartPoint[];
  /**
   * `GET /api/places?area=&lat=&lon=`: how the command post would name that point when a track is
   * placed there ("120 m north-east of Château de Vincennes"). `places` is then empty.
   */
  label?: string;
}

/** `POST /api/sessions/<code>/tracks` and `PATCH /api/sessions/<code>/tracks/<n>` */
export interface PlotReply {
  entry: PlotEntry;
}

/** `POST /api/sessions/<code>/join` */
export interface JoinReply {
  mission: MissionSummary;
  callsign: string;
  /** Where the coordinator has this unit now: the start point (≈) on a first join, or its latest fix on a rejoin. */
  position: UnitPosition | null;
  /** When that position was given, epoch ms. */
  positionTs: number | null;
  /** True when this device already held the call sign. */
  rejoined: boolean;
}

/** `GET /api/sessions/<code>?after=<n>` */
export interface SessionLogReply {
  session: string;
  /** False when this coordinator keeps no record (for now, the hosted site). */
  stored: boolean;
  /** Entries in the log in all; pass it back as `after` to get only newer ones. */
  total: number;
  entries: LogEntry[];
}

const SESSION_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** A session code as stored: lower case, letters, digits, - and _, up to 40 characters. Null if not valid. */
export function sessionCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return SESSION_RE.test(s) ? s : null;
}

/** A call sign as stored: capitals, trimmed, single spaces, up to 24 characters, so "alpha 1" is ALPHA 1. */
export function callsignOf(v: unknown): string {
  if (typeof v !== "string") return "UNKNOWN";
  const s = v.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 24);
  return s || "UNKNOWN";
}
