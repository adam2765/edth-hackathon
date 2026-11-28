/**
 * The shared record: a mission's opening, every unit that joins, every report and every answer to
 * a question, an answer heard and waiting for a confirm, what the command post did to a track by hand, a unit it placed by hand, radio reports held for the operator
 * and what the operator did with them, and the mission's end, as one append-only log per session. The coordinator writes it; the command post reads it and rebuilds
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
  from: { lat: number; lon: number; radius_m?: number } | null;
  /** The continuous bearing as said, or the centre of a compass bin; null when none. */
  bearing_deg?: number | null;
  bearing_source?: "degrees" | "mils" | "clock" | "compass8" | null;
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
  /** Set for a radio report: how the coordinator found who sent it [202]. Absent from a phone that joined. */
  sender?: Sender;
  timings_ms: Timings;
}

/**
 * How a radio report's sender was found [202]. A phone names itself; a radio report names its
 * sender in its words, read against the mission's roster (decision 200).
 */
export interface Sender {
  /** The words the call sign was read from, as speech-to-text wrote them; null when none was said. */
  heard: string | null;
  /**
   * `exact` or `near`: read from the words, one roster entry. `reply`: no call sign was said, and
   * one unit had an open question, so it is that unit's reply [204]. `operator`: the command post
   * gave it to this unit from the Unassigned tray [203].
   */
  how: "exact" | "near" | "reply" | "operator";
  /** For `operator`: the held report it came from. */
  held?: string;
}

/** Why a radio report waits for the operator instead of going to a unit [203, 204]. */
export type HeldReason =
  /** Two roster entries are close ("Alpha to base"), or one is and the words may name another unit. */
  | "which"
  /** A call sign not on the roster ("CHARLIE 3, checking in"); `read` holds it. */
  | "unknown"
  /** No call sign, and no open question it could answer; or no words at all. */
  | "none"
  /** The words name a unit, but the report would move it farther than it could have gone [204]. */
  | "far";

/**
 * A radio report the coordinator did not give to a unit by itself: it waits in the command post's
 * Unassigned tray until the operator assigns it, adds the call sign heard, or dismisses it [203].
 * A transcript never creates a unit and never moves one it is not sure of.
 */
export interface HeldEntry {
  kind: "held";
  id: string;
  session: string;
  ts: number;
  clientTs: number | null;
  area: AreaId;
  transcript: string;
  language: string | null;
  reason: HeldReason;
  /** The words the call sign was read from, as speech-to-text wrote them; null when none was said. */
  heard: string | null;
  /** A call sign heard that is not on the roster ("CHARLIE 3"), for "Add CHARLIE 3". */
  read: string | null;
  /** Roster entries it may be from, most likely first. */
  candidates: string[];
  /** What the operator is asked ("ALPHA 2 moved 3.2 km in 20 s. Was that ALPHA 1?"). */
  question: string;
  /** For `far`: where the report would have put the unit heard. */
  position?: UnitPosition | null;
  /** The recording's file name, served by `GET /api/sessions/<code>/audio/<file>`; null for a typed report. */
  audio: string | null;
}

/** The operator adds a call sign to the mission's roster [201]. Only this, or the roster at opening, makes a unit. */
export interface RosterEntry {
  kind: "roster";
  id: string;
  session: string;
  ts: number;
  /** Who added it: "CP". */
  by: string;
  callsign: string;
  /** The held report whose call sign it was ("Add CHARLIE 3"), if it came from the tray. */
  held?: string;
}

/**
 * A person at the command post says what a unit is [235]: a foot patrol, a vehicle crew, a drone
 * team. The same kinds as a track's; null when not said. Never read from the call sign or from the
 * words: "DRONE 1" proves nothing. A unit whose kind is drone or drone team can be sent to look at a
 * track [234].
 */
export interface UnitEntry {
  kind: "unit";
  id: string;
  session: string;
  ts: number;
  /** Who said it: "CP". */
  by: string;
  callsign: string;
  unit_kind: TrackKind | null;
}

/**
 * A person at the command post puts a unit at a place by hand [243]: the unit said where it is and
 * the app did not place it, or placed it wrongly. A point clicked on the map or a gazetteer place
 * picked by name, never a model's output. The unit itself was not heard.
 */
export interface FixEntry {
  kind: "fix";
  id: string;
  session: string;
  ts: number;
  /** Who did it: "CP". */
  by: string;
  callsign: string;
  position: UnitPosition;
  /** Where the information came from, as typed ("heard on the net", "by phone"). */
  note?: string | null;
}

/** The operator dismisses a held report: noise, or not for this net [203]. It stays in the log. */
export interface DismissEntry {
  kind: "dismiss";
  id: string;
  session: string;
  ts: number;
  by: string;
  held: string;
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

/** How a spoken answer named its choice [251]: its number, its name or kind, the nearer one, or "yes" to a single choice. */
export type HeardHow = "number" | "name" | "nearest" | "yes";

/**
 * What a unit said while its question was open, read in code as an answer that picks one of the
 * choices [251]: "two", "the metro station". It is not a report and moves nothing. The command post
 * shows the choice already picked, and the operator confirms it with an `answer`.
 */
export interface ReplyEntry {
  kind: "reply";
  id: string;
  session: string;
  callsign: string;
  ts: number;
  clientTs: number | null;
  /** The report whose question it answers. */
  report_id: string;
  transcript: string;
  language: string | null;
  /** The choice heard: the id of one of that question's candidates. */
  choice: string;
  how: HeardHow;
  /** For a radio report: how its sender was found [202]. */
  sender?: Sender;
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

/**
 * A unit asks for a drone to look at a track [234]: "send the drone", "request eyes on", read from
 * its words in code, in the same call as a report or on its own. It only asks: a person at the
 * command post decides whether anything is sent, with a `task` entry. It stays open until then.
 */
export interface RequestEntry {
  kind: "request";
  id: string;
  session: string;
  ts: number;
  /** Who asked. */
  callsign: string;
  /** The track it is about: named in the words, or the one the report opened or saw; null when none. */
  n: number | null;
  /** The request as it was said ("send the drone"). */
  words: string;
  /** The report it came with; null when the call was only the request. */
  report_id: string | null;
  /** Set for a radio request: how its sender was found [202]. */
  sender?: Sender;
}

/** What the command post can do about recon [234]: send a drone to look, end it, or turn a request down. */
export type TaskAction = "send" | "done" | "decline";

/**
 * A person at the command post sends a friendly drone or drone team to look at a track, ends that,
 * or turns a request down [234]. The drone is a friendly track, or a unit on the net whose kind is
 * drone or drone team [235]. Never written by a model or worked out by the app: no range, no
 * nearest, no ranking. A drone looks at one track at a time; sending it again moves it.
 */
export interface TaskEntry {
  kind: "task";
  id: string;
  session: string;
  ts: number;
  /** Who did it: "CP". */
  by: string;
  action: TaskAction;
  /** For `send` and `done`: the friendly drone or drone team, by its track number. */
  asset?: number;
  /** For `send` and `done`, instead of `asset`: a unit on the net whose kind is drone or drone team [235]. */
  unit?: string;
  /** For `send`: the track it is to look at. */
  n?: number;
  /** For `send` and `decline`: the request it answers, if any. */
  request?: string;
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
  /**
   * The call signs on the radio net, set by the operator when opening the mission [201]. A radio
   * report goes only to a call sign on the roster. Absent from missions opened before it.
   */
  roster?: string[];
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

export type LogEntry = MissionEntry | JoinEntry | EndEntry | ReportEntry | AnswerEntry | ReplyEntry | PlotEntry | HeldEntry | RosterEntry | DismissEntry | RequestEntry | TaskEntry | UnitEntry | FixEntry;

/** One mission as listed by `GET /api/sessions` and returned when one is opened, joined or ended. */
export interface MissionSummary {
  code: string;
  name: string;
  area: AreaId;
  start: StartPoint | null;
  /** The call signs a radio report can go to: the roster set at opening, those the operator added, and phones that joined [201]. */
  roster: string[];
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

/** `POST /api/sessions/<code>/held/<id>`: what the operator did with a held report [203]. */
export interface HeldReply {
  /** The report the held one became, for `assign` and `add`; null for `dismiss`. */
  report_id: string | null;
  /** The unit it went to. */
  callsign: string | null;
  /** True when someone had settled it already: the first decision stands. */
  already: boolean;
}

/** `POST /api/sessions/<code>/tracks` and `PATCH /api/sessions/<code>/tracks/<n>` */
export interface PlotReply {
  entry: PlotEntry;
}

/** `POST /api/sessions/<code>/tasks` [234] */
export interface TaskReply {
  /** The entry written; null when the request had been settled already. */
  entry: TaskEntry | null;
  /** True when someone had settled the request already: the first decision stands. */
  already: boolean;
}

/** `POST /api/sessions/<code>/units`: what a person at the command post said a unit is [235]. */
export interface UnitReply {
  /** Null when the unit already had that kind: nothing was written. */
  entry: UnitEntry | null;
}

/**
 * The `heard` field of the report reply: the words were taken as an answer to the unit's open
 * question, and wait for the command post's confirm [251]. The reply's `report_id` is then the id
 * of the `reply` entry, so a phone knows its words were saved.
 */
export interface HeardReply {
  /** The report whose question the words answer. */
  question: string;
  /** The choice heard: its candidate id, its number on the operator's screen, and its name. */
  choice: string;
  n: number;
  name: string;
  how: HeardHow;
}

/** `POST /api/sessions/<code>/units/position`: where a person at the command post put a unit [243]. */
export interface FixReply {
  entry: FixEntry;
}

/** The `request` field of the report reply: the request read from the words, as saved [234]. */
export interface RequestReply {
  id: string;
  n: number | null;
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

/** A report with no call sign is a radio report: the call sign comes from its words [202]. */
export function callsignGiven(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** The most call signs a roster takes at once. */
export const ROSTER_MAX = 30;

/**
 * A roster as stored: each call sign as `callsignOf` stores it, no blanks, no repeats, at most 30.
 * Takes a list, or text with one call sign per line or comma ("ALPHA 1, ALPHA 2").
 */
export function rosterOf(v: unknown): string[] {
  const list = typeof v === "string" ? v.split(/[,;\n]+/) : Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const x of list) {
    if (typeof x !== "string" || !x.trim()) continue;
    const c = callsignOf(x);
    if (c !== "UNKNOWN" && !out.includes(c)) out.push(c);
  }
  return out.slice(0, ROSTER_MAX);
}
