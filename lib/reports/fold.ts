/**
 * Rebuilds the command post's picture from the log: the mission, where each call sign is, its
 * trail, any open question, the tracks, and the feed. Pure, so the live view and a replay are the
 * same function, and a replay is the log read up to a moment. The coordinator uses it too, for
 * each unit's last position. Safe to import on the client.
 */
import type { AreaId } from "@/lib/geo/areas";
import type { Affiliation, Candidate, Direction, Resolution, TrackKind } from "@/lib/geo/types";
import { bearingDeg, distanceM } from "../geo/geo";
import { describeTrack, TRACK_KIND_NAME } from "../geo/trackKinds";
import type { HeldEntry, JoinEntry, LogEntry, PlotEntry, ReportEntry, RequestEntry, Sender, StartPoint, TaskEntry, TrackSighting, UnitEntry, UnitPosition } from "./types";

/** The command post's colour in the feed: a slate grey no call sign is given. */
export const CP_COLOUR = "#334155";

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
  /** Last join, report or answer from this call sign; 0 for a call sign on the roster not heard yet. */
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
  /** What it is, as a person at the command post said: a foot patrol, a drone team; null when not said [235]. */
  kind: TrackKind | null;
  /** For a unit whose kind is drone or drone team: the track the command post sent it to look at [235]. */
  task: { n: number; ts: number; by: string } | null;
  /**
   * Its latest report asked something with no choices ("How far east is it?") and nothing has
   * closed it yet: the operator asks it by radio, or closes it [242].
   */
  prompt: { reportId: string; ts: number; question: string } | null;
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
  /** The latest place came from the command post, not from a unit's report. */
  plotted: boolean;
  /** The command post's latest change to whose or what it is, when there was one. */
  changed: { by: string; ts: number } | null;
  /** Where the command post's information came from, as typed. */
  note: string | null;
  /** When the command post marked it gone; null while it is on the map. A new report brings it back. */
  gone: number | null;
  /** For a friendly drone or drone team: the track the command post sent it to look at, until it ends [234]. */
  task: { n: number; ts: number; by: string } | null;
  /**
   * The friendly drones and drone teams sent to look at this track [234]: a track by its number
   * (`asset`), or a unit on the net by its call sign (`unit`) [235].
   */
  recon: { asset: number | null; unit: string | null; ts: number }[];
}

/**
 * A unit's request for recon, open until the command post sends a drone to that track or turns it
 * down, or the mission ends [234].
 */
export interface RequestState {
  id: string;
  ts: number;
  callsign: string;
  colour: string;
  /** The track it is about; null when none was named. */
  n: number | null;
  words: string;
  report_id: string | null;
}

export interface FeedItem {
  /**
   * A report, a call sign joining, something the command post did to a track, or a note of what it
   * did with a held radio report (added a call sign, dismissed the report) or said a unit is [235].
   */
  kind: "report" | "join" | "plot" | "note" | "request" | "task";
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
  /** `by` is set when the command post chose for the unit. */
  answer: { ts: number; choice: string | null; name: string | null; by: string | null } | null;
  /** The mission ended while the question was open, so it can no longer be answered. */
  expired: boolean;
  /** What the report asked, with choices or without; absent when it asked nothing. */
  question?: string | null;
  /** The same unit reported again while the question was open, so it is closed and cannot be answered [241]. */
  overtaken?: boolean;
  /** For a radio report: how its sender was found [202]. */
  sender?: Sender;
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
  /** Roster call signs first, in roster order, then any other that joined or reported. */
  units: UnitState[];
  /** The call signs a radio report can go to [201]. */
  roster: string[];
  /** Radio reports waiting for the operator, oldest first [203]. */
  held: HeldEntry[];
  /** Requests for recon not yet answered, oldest first [234]. */
  requests: RequestState[];
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

/** Colours by call sign, from the whole log, so a call sign keeps its colour through a replay. Roster order first. */
export function colourMap(entries: LogEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  const give = (c: string) => {
    if (!m.has(c)) m.set(c, UNIT_COLOURS[m.size % UNIT_COLOURS.length]);
  };
  for (const e of entries) {
    if (e.kind === "mission") (e.roster ?? []).forEach(give);
    else if (e.kind === "report" || e.kind === "join" || e.kind === "answer" || e.kind === "roster" || e.kind === "request" || e.kind === "unit") give(e.callsign);
  }
  return m;
}

/** How a radio report's sender was found, in words for the feed [202]. */
export function describeSender(s: Sender): string {
  const words = s.heard ? `“${s.heard}”` : "no call sign";
  switch (s.how) {
    case "exact":
      return `Call sign heard: ${words}.`;
    case "near":
      return `Call sign heard: ${words}, close to this one only.`;
    case "reply":
      return "No call sign: taken as the reply to this unit's open question.";
    case "operator":
      return `Call sign heard: ${words}. Given to this unit by the command post.`;
  }
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

/** What the command post did to a track, in words. */
function plotOutcome(e: PlotEntry, t: TrackState): string {
  const p = e.position;
  const at = p ? `${p.label} (±${p.radius_m} m)` : "";
  const note = e.note ? ` Source: ${e.note}.` : "";
  switch (e.action) {
    case "place":
      return `Placed Track ${t.n}: ${describeTrack(t)}, ${at}.${note}`;
    case "edit":
      return `Changed Track ${t.n}: now ${describeTrack(t)}.${note}`;
    case "move":
      return `Moved Track ${t.n}: ${at}.${note}`;
    case "gone":
      return `Track ${t.n} marked gone. It is off the map.`;
    case "restore":
      return `Track ${t.n} back on the map.`;
  }
}

/** A request for recon, in words for the feed [234]. */
function requestOutcome(e: RequestEntry): string {
  return e.n != null ? `Asked for recon on Track ${e.n}: “${e.words}”` : `Asked for recon, no track named: “${e.words}”`;
}

/** A unit's kind, in words: "drone team", "people" [235]. */
export function unitKindWord(kind: TrackKind): string {
  return TRACK_KIND_NAME[kind].toLowerCase();
}

/** What a person at the command post said a unit is, in words [235]. */
function unitOutcome(e: UnitEntry): string {
  return e.unit_kind ? `${e.callsign} is a ${unitKindWord(e.unit_kind)}.` : `${e.callsign}: what it is, cleared.`;
}

/** The drone a task is about, in words: "Track 1 (friendly drone team)", or "BRAVO 2 (drone team)" for a unit [235]. */
function droneName(e: TaskEntry, asset: TrackState | undefined, unit: UnitState | undefined): string {
  if (e.unit != null) return unit?.kind ? `${e.unit} (${unitKindWord(unit.kind)})` : e.unit;
  return asset ? `Track ${asset.n} (${describeTrack(asset)})` : `Track ${e.asset}`;
}

/** What the command post did about recon, in words [234]. `was` is the track the drone looked at before. */
function taskOutcome(e: TaskEntry, drone: string, was: number | null, req: RequestState | undefined): string {
  switch (e.action) {
    case "send":
      return `Sent ${drone} to look at Track ${e.n}${was != null && was !== e.n ? `, instead of Track ${was}` : ""}.${req ? ` ${req.callsign} had asked.` : ""}`;
    case "done":
      return `${drone}: recon${was != null ? ` of Track ${was}` : ""} done.`;
    case "decline":
      return req ? `Declined ${req.callsign}’s request for recon${req.n != null ? ` on Track ${req.n}` : ""}: “${req.words}”` : "Declined a request for recon.";
  }
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
  if (r.evidence.rule === "request_only") return "Nothing to place: only a request for recon.";
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
  const roster: string[] = [];
  const held = new Map<string, HeldEntry>();
  const requests = new Map<string, RequestState>();
  const enlist = (c: string) => {
    if (!roster.includes(c)) roster.push(c);
  };

  const unitFor = (callsign: string, a: AreaId): UnitState => {
    let u = units.get(callsign);
    if (!u) {
      u = { callsign, colour: colours.get(callsign) ?? UNIT_COLOURS[0], area: a, position: null, positionTs: null, trail: [], lastHeard: 0, pending: null, joined: null, device: null, atStart: false, street: null, kind: null, task: null, prompt: null };
      units.set(callsign, u);
    }
    return u;
  };

  /**
   * A question the unit has moved past: its own later report closes it, and an answer that comes
   * after would place it from where it was before [241].
   */
  const overtake = (reportId: string) => {
    const item = feed.get(reportId);
    if (item && !item.answer && !item.expired && !item.overtaken) {
      item.overtaken = true;
      item.outcome = `${item.outcome} Overtaken by a later report.`;
    }
    for (const t of tracks.values()) if (t.pendingReport === reportId) t.pendingReport = null;
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
        plotted: false,
        changed: null,
        note: null,
        gone: null,
        task: null,
        recon: [],
      };
      tracks.set(s.n, t);
    } else {
      if (s.affiliation) t.affiliation = s.affiliation;
      if (s.kind) t.kind = s.kind;
      if (s.count) t.count = s.count;
      if (s.text) t.text = s.text;
      t.seenBy = e.callsign;
      t.seenTs = e.ts;
      // Reported again: it is there after all.
      t.gone = null;
    }
    if (s.position) {
      t.plotted = false;
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

  /** Takes in what the command post did to a track by hand. Null when the track is not known. */
  const plotTrack = (e: PlotEntry): TrackState | null => {
    let t = tracks.get(e.n);
    if (e.action === "place" && !t) {
      if (!e.position) return null;
      t = {
        n: e.n,
        affiliation: e.affiliation ?? "unknown",
        kind: e.track_kind ?? "other",
        count: e.count ?? null,
        text: null,
        heading: null,
        area: mission?.area ?? area ?? "vincennes",
        position: null,
        positionTs: null,
        trail: [],
        seenBy: e.by,
        seenTs: e.ts,
        // Nobody at the command post saw it from a point on the map: no line of sight.
        from: null,
        openedBy: e.by,
        openedTs: e.ts,
        pendingReport: null,
        plotted: true,
        changed: null,
        note: e.note ?? null,
        gone: null,
        task: null,
        recon: [],
      };
      tracks.set(e.n, t);
      placeTrack(t, e.position, e.ts);
      return t;
    }
    if (!t) return null;
    if (e.note) t.note = e.note;
    if (e.action === "edit" || e.action === "place") {
      if (e.affiliation) t.affiliation = e.affiliation;
      if (e.track_kind) t.kind = e.track_kind;
      if (e.count !== undefined) t.count = e.count;
      t.changed = { by: e.by, ts: e.ts };
    }
    if ((e.action === "move" || e.action === "place") && e.position) {
      placeTrack(t, e.position, e.ts);
      t.seenBy = e.by;
      t.seenTs = e.ts;
      t.from = null;
      // The way it was moving belonged to the last sighting.
      t.heading = null;
      t.plotted = true;
      t.gone = null;
    }
    if (e.action === "gone") t.gone = e.ts;
    if (e.action === "restore") t.gone = null;
    return t;
  };

  /** Closes a request for recon, and says how in its feed line. */
  const closeRequest = (id: string, how: string, expired = false) => {
    if (!requests.delete(id)) return;
    const item = feed.get(id);
    if (item) {
      item.outcome = `${item.outcome} ${how}`;
      item.expired = expired;
    }
  };

  for (const e of entries) {
    if (e.ts > upTo) continue;
    first ??= e.ts;
    last = e.ts;

    if (e.kind === "mission") {
      mission = { name: e.name, area: e.area, start: e.start, opened: e.ts, ended: null };
      area = e.area;
      // The roster's units are listed from the start, not heard yet [201].
      for (const c of e.roster ?? []) {
        enlist(c);
        unitFor(c, e.area);
      }
      continue;
    }

    if (e.kind === "held") {
      held.set(e.id, e);
      continue;
    }

    if (e.kind === "roster" || e.kind === "dismiss") {
      const was = e.held ? held.get(e.held) : undefined;
      if (e.kind === "dismiss") held.delete(e.held);
      else {
        enlist(e.callsign);
        unitFor(e.callsign, mission?.area ?? area ?? "vincennes");
      }
      feed.set(e.id, {
        kind: "note",
        id: e.id,
        ts: e.ts,
        callsign: e.by,
        colour: CP_COLOUR,
        area: mission?.area ?? area ?? "vincennes",
        transcript: was?.transcript ?? "",
        status: "resolved",
        outcome: e.kind === "roster" ? `Added ${e.callsign} to the roster.` : was?.transcript ? `Dismissed a radio report: “${was.transcript}”` : "Dismissed a radio report.",
        position: null,
        candidates: [],
        answer: null,
        expired: false,
        track: null,
      });
      continue;
    }

    if (e.kind === "end") {
      if (mission) mission.ended = e.ts;
      // Questions still open, with choices or without, can no longer be answered.
      for (const u of units.values()) {
        for (const id of [u.pending?.reportId, u.prompt?.reportId]) {
          const item = id ? feed.get(id) : undefined;
          if (item) {
            item.expired = true;
            item.outcome = `${item.outcome} Not answered before the mission ended.`;
          }
        }
        u.pending = null;
        u.prompt = null;
        u.task = null;
      }
      for (const t of tracks.values()) {
        t.pendingReport = null;
        // Nobody is looking any more once the mission is over.
        t.task = null;
      }
      for (const id of [...requests.keys()]) closeRequest(id, "Not answered before the mission ended.", true);
      continue;
    }

    if (e.kind === "unit") {
      const u = unitFor(e.callsign, mission?.area ?? area ?? "vincennes");
      u.kind = e.unit_kind;
      feed.set(e.id, {
        kind: "note",
        id: e.id,
        ts: e.ts,
        callsign: e.by,
        colour: CP_COLOUR,
        area: u.area,
        transcript: "",
        status: "resolved",
        outcome: unitOutcome(e),
        position: null,
        candidates: [],
        answer: null,
        expired: false,
        track: null,
      });
      continue;
    }

    if (e.kind === "request") {
      const u = unitFor(e.callsign, mission?.area ?? area ?? "vincennes");
      // The unit said it: it was heard, as with a report.
      u.lastHeard = Math.max(u.lastHeard, e.ts);
      requests.set(e.id, { id: e.id, ts: e.ts, callsign: e.callsign, colour: u.colour, n: e.n, words: e.words, report_id: e.report_id });
      feed.set(e.id, {
        kind: "request",
        id: e.id,
        ts: e.ts,
        callsign: e.callsign,
        colour: u.colour,
        area: u.area,
        transcript: "",
        status: "resolved",
        outcome: requestOutcome(e),
        position: null,
        candidates: [],
        answer: null,
        expired: false,
        track: e.n,
        ...(e.sender ? { sender: e.sender } : {}),
      });
      continue;
    }

    if (e.kind === "task") {
      // The drone: a friendly track, or a unit on the net whose kind is drone or drone team [235].
      const asset = e.asset != null ? tracks.get(e.asset) : undefined;
      const unit = e.unit != null ? units.get(e.unit) : undefined;
      const looker = asset ?? unit;
      const drone = droneName(e, asset, unit);
      const req = e.request ? requests.get(e.request) : undefined;
      const was = looker?.task?.n ?? null;
      if (e.action === "send") {
        if (!looker || e.n == null || !tracks.has(e.n)) continue;
        looker.task = { n: e.n, ts: e.ts, by: e.by };
        // A drone sent to a track answers every open request for that track.
        const who = asset ? `Track ${asset.n}` : e.unit;
        for (const r of [...requests.values()]) if (r.id === e.request || r.n === e.n) closeRequest(r.id, `${e.by} sent ${who}.`);
      } else if (e.action === "done") {
        if (!looker) continue;
        looker.task = null;
      } else if (e.request) closeRequest(e.request, `${e.by} declined it.`);
      feed.set(e.id, {
        kind: "task",
        id: e.id,
        ts: e.ts,
        callsign: e.by,
        colour: CP_COLOUR,
        area: looker?.area ?? mission?.area ?? area ?? "vincennes",
        transcript: "",
        status: "resolved",
        outcome: taskOutcome(e, drone, was, req),
        position: null,
        candidates: [],
        answer: null,
        expired: false,
        track: e.action === "send" ? (e.n ?? null) : e.action === "done" ? (e.asset ?? was) : (req?.n ?? null),
      });
      continue;
    }

    if (e.kind === "join") {
      enlist(e.callsign);
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

    if (e.kind === "plot") {
      const t = plotTrack(e);
      if (t) {
        feed.set(e.id, {
          kind: "plot",
          id: e.id,
          ts: e.ts,
          callsign: e.by,
          colour: CP_COLOUR,
          area: t.area,
          transcript: "",
          status: "resolved",
          outcome: plotOutcome(e, t),
          position: e.position ?? null,
          candidates: [],
          answer: null,
          expired: false,
          track: t.n,
        });
      }
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
      // A held radio report the operator gave to this unit leaves the tray [203].
      if (e.sender?.held) held.delete(e.sender.held);
      // Whatever the unit says next overtakes a question with no choices it was asked [241, 242].
      if (u.prompt) {
        overtake(u.prompt.reportId);
        u.prompt = null;
      }
      const asked = u.pending?.reportId ?? null;
      if (e.position && !seen) {
        move(u, e.position, e.ts);
        u.street = streetAfter(u.street, r.candidates.find((c) => c.id === r.evidence.feature_id));
        u.pending = null;
      } else if (r.status === "ambiguous") {
        u.pending = { reportId: e.id, ts: e.ts, question: r.question ?? "Which one?", candidates: r.candidates };
      } else if (r.status === "resolved" && !seen) {
        u.pending = null;
      }
      // A question with choices the unit has moved past, by a new place or a new question, is closed [241].
      if (asked && u.pending?.reportId !== asked) overtake(asked);
      if (r.status === "unresolved" && r.question) u.prompt = { reportId: e.id, ts: e.ts, question: r.question };
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
        question: r.question ?? null,
        track: seen ? seen.track.n : null,
        ...(e.sender ? { sender: e.sender } : {}),
      });
      continue;
    }

    // An answer to a question.
    const item = feed.get(e.report_id);
    const u = unitFor(e.callsign, item?.area ?? area ?? "vincennes");
    // An answer the command post chose says nothing about whether the unit is still there.
    if (!e.by) u.lastHeard = Math.max(u.lastHeard, e.ts);
    if (u.pending?.reportId === e.report_id) u.pending = null;
    const chose = e.by ? `${e.by} chose` : "Chose";
    const none = e.by ? `${e.by}: none of the choices was right.` : "None of the choices was right.";
    const chosen = e.choice ? (item?.candidates.find((c) => c.id === e.choice) ?? null) : null;
    // A newer fix since the question beats a late answer to it.
    const reportTs = item?.ts ?? e.ts;
    // A question with no choices, closed by the command post: nothing moves [242].
    if (item?.status === "unresolved") {
      if (u.prompt?.reportId === e.report_id) u.prompt = null;
      item.answer = { ts: e.ts, choice: null, name: null, by: e.by ?? null };
      item.outcome = `Closed by ${e.by ?? e.callsign}: ${item.question ?? item.outcome}`;
      continue;
    }
    // An answer to a question the unit had moved past moves nothing; the coordinator now refuses one [241].
    if (item?.overtaken) {
      item.answer = { ts: e.ts, choice: e.choice, name: chosen?.name ?? null, by: e.by ?? null };
      item.outcome = `${e.choice ? `${chose} ${chosen?.name ?? e.choice}.` : none} The unit had reported again, so nothing moved.`;
      continue;
    }
    if (e.track) {
      // The answer places the track; the speaker stays where they are.
      const t = tracks.get(e.track.n);
      const p = e.track.position;
      if (t?.pendingReport === e.report_id) t.pendingReport = null;
      if (t && p && (t.positionTs == null || t.positionTs <= reportTs)) placeTrack(t, p, e.ts);
      if (item) {
        item.answer = { ts: e.ts, choice: e.choice, name: chosen?.name ?? null, by: e.by ?? null };
        item.position = p;
        item.outcome = e.choice ? `${chose} ${chosen?.name ?? e.choice}. ${p ? `Track ${e.track.n} ${trackWhere(p)}` : "Nothing to place"}` : `${none} Track ${e.track.n} is not placed.`;
      }
      continue;
    }
    if (e.position && (u.positionTs == null || u.positionTs <= reportTs)) {
      move(u, e.position, e.ts);
      u.street = streetAfter(u.street, chosen ?? undefined);
    }
    if (item) {
      item.answer = { ts: e.ts, choice: e.choice, name: chosen?.name ?? null, by: e.by ?? null };
      item.position = e.position;
      item.outcome = e.choice ? `${chose} ${chosen?.name ?? e.choice}. ${e.position ? describePosition(e.position) : "Nothing to place"}` : none;
    }
  }

  // Who is looking at what, from each drone's task: drone tracks, then drone units [235].
  for (const t of tracks.values()) {
    if (!t.task) continue;
    tracks.get(t.task.n)?.recon.push({ asset: t.n, unit: null, ts: t.task.ts });
  }
  for (const u of units.values()) {
    if (!u.task) continue;
    tracks.get(u.task.n)?.recon.push({ asset: null, unit: u.callsign, ts: u.task.ts });
  }

  return {
    mission,
    units: [...units.values()],
    roster,
    held: [...held.values()],
    requests: [...requests.values()],
    tracks: [...tracks.values()].sort((a, b) => a.n - b.n),
    feed: [...feed.values()].sort((a, b) => b.ts - a.ts),
    first,
    last,
    area,
  };
}
