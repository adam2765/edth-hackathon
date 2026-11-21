/** Saving to the shared record: missions, joins, reports, answers and ends. Server only. */
import type { AreaId } from "@/lib/geo/areas";
import type { Intent, LastPosition, Resolution } from "@/lib/geo/types";
import { withTrackNumber, type KnownTrack } from "../geo/tracks";
import { FADE_AFTER_MS, foldLog, headingOf } from "./fold";
import { endOf, missionOf, sortMissions, startPosition, summarizeMission, toLastPosition } from "./mission";
import { positionFromPlacement, positionFromReport } from "./position";
import { getStore, newEntryId, withSessionLock } from "./store";
import type {
  AnswerEntry,
  EndEntry,
  JoinEntry,
  JoinReply,
  LogEntry,
  MissionEntry,
  MissionListReply,
  MissionSummary,
  ReportEntry,
  StartPoint,
  Timings,
  TrackSighting,
} from "./types";

/** A refusal, with the HTTP status the endpoint returns. `ended` and `taken` let a phone say why. */
export type Refusal = { ok: false; status: number; error: string; ended?: true; taken?: true };

const NO_RECORD: Refusal = { ok: false, status: 501, error: "This coordinator keeps no record, so it has no missions." };
const NO_MISSION: Refusal = { ok: false, status: 404, error: "No mission with that code." };
const ENDED: Refusal = { ok: false, status: 409, error: "This mission has ended.", ended: true };

// ---- missions ----

export async function listMissions(): Promise<MissionListReply> {
  const store = getStore();
  if (store.kind === "none") return { stored: false, missions: [] };
  const { kept } = await store.sessions();
  const missions: MissionSummary[] = [];
  for (const code of kept) {
    const s = summarizeMission(code, (await store.list(code)).entries);
    if (s) missions.push(s);
  }
  return { stored: true, missions: sortMissions(missions) };
}

/** Opens a mission with the next free code for its area: vincennes-1, vincennes-2, … A code is never reused. */
export async function createMission(
  input: { area: AreaId; name: string; start: StartPoint | null },
  now = Date.now(),
): Promise<{ ok: true; mission: MissionSummary } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  const { used } = await store.sessions();
  const re = new RegExp(`^${input.area}-(\\d+)$`);
  let n = Math.max(0, ...used.map((c) => Number(re.exec(c)?.[1] ?? 0))) + 1;
  for (let tries = 0; tries < 50; tries++, n++) {
    const entry: MissionEntry = { kind: "mission", id: newEntryId(now), session: `${input.area}-${n}`, ts: now, ...input };
    if (await store.create(entry)) return { ok: true, mission: summarizeMission(entry.session, [entry])! };
  }
  return { ok: false, status: 500, error: "Could not find a free mission code." };
}

/**
 * A call sign joins. One phone per call sign: another phone gets 409 while the holder has been
 * heard in the last 3 minutes, and takes the call sign over after that. The same phone joining
 * again gets its unit back as it is, and nothing is written.
 */
export async function joinMission(session: string, callsign: string, device: string, now = Date.now()): Promise<{ ok: true; reply: JoinReply } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    const mission = missionOf(entries);
    if (!mission) return NO_MISSION;
    if (endOf(entries)) return ENDED;
    const u = foldLog(entries).units.find((x) => x.callsign === callsign);
    const held = u?.joined != null;
    if (held && u.device === device) {
      return { ok: true, reply: { mission: summarizeMission(session, entries)!, callsign, position: u.position, positionTs: u.positionTs, rejoined: true } };
    }
    if (held && u.device && now - u.lastHeard < FADE_AFTER_MS) {
      return { ok: false, status: 409, error: `${callsign} is in use on another phone. Pick another call sign.`, taken: true };
    }
    const entry: JoinEntry = {
      kind: "join",
      id: newEntryId(now),
      session,
      callsign,
      ts: now,
      device,
      // A unit already on the map keeps its place; a new one starts around the start point.
      position: !u?.position && mission.start ? startPosition(mission.start) : null,
    };
    await store.append(entry);
    const position = u?.position ?? entry.position;
    const positionTs = u?.position ? u.positionTs : entry.position ? now : null;
    return { ok: true, reply: { mission: summarizeMission(session, [...entries, entry])!, callsign, position, positionTs, rejoined: false } };
  });
}

/** Ends a mission. Ending one that has ended already changes nothing. */
export async function endMission(session: string, now = Date.now()): Promise<{ ok: true; mission: MissionSummary } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    if (!missionOf(entries)) return NO_MISSION;
    if (endOf(entries)) return { ok: true, mission: summarizeMission(session, entries)! };
    const entry: EndEntry = { kind: "end", id: newEntryId(now), session, ts: now };
    await store.append(entry);
    return { ok: true, mission: summarizeMission(session, [...entries, entry])! };
  });
}

/** Deletes an ended mission (its file moves to `deleted/`). An open one has to be ended first. */
export async function deleteMission(session: string): Promise<{ ok: true } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    if (!entries.length) return NO_MISSION;
    if (missionOf(entries) && !endOf(entries)) return { ok: false, status: 409, error: "End the mission before deleting it." };
    return (await store.remove(session)) ? { ok: true } : NO_MISSION;
  });
}

// ---- reports ----

/** What a report in a session works with: the mission's area, and the unit's last position from the log. */
export type ReportContext = { ok: true; area: AreaId; lastPosition: LastPosition | null; inMission: boolean; tracks: KnownTrack[] };

/**
 * For a report to a mission: refuses an unknown or ended mission, and gives the area and the
 * speaker's last position from the log (their latest fix, else the start point). The phone's own
 * `lastPosition` is then ignored, so the receiver and the resolver agree on where a unit is.
 * With no record kept, the phone's area and position are used as before.
 * It also lists the mission's tracks, so a number the speaker says ("Track 3") can be checked.
 */
export async function reportContext(
  session: string,
  callsign: string,
  fallback: { area: AreaId; lastPosition: LastPosition | null },
  now = Date.now(),
): Promise<ReportContext | Refusal> {
  const store = getStore();
  if (store.kind === "none") return { ok: true, ...fallback, inMission: false, tracks: [] };
  const { entries } = await store.list(session);
  const mission = missionOf(entries);
  if (!mission) return NO_MISSION;
  if (endOf(entries)) return ENDED;
  const state = foldLog(entries);
  const u = state.units.find((x) => x.callsign === callsign);
  let lastPosition: LastPosition | null = null;
  if (u?.position && u.positionTs != null) {
    // The street and the way it was going let "the next crossing" be found (decision 117).
    const heading = headingOf(u);
    lastPosition = { ...toLastPosition(u.position, u.positionTs), ...(u.street ? { street: u.street } : {}), ...(heading != null ? { heading_deg: heading } : {}) };
  } else if (mission.start) {
    lastPosition = { ...toLastPosition(startPosition(mission.start), now), ...(mission.start.category === "street" ? { street: mission.start.id } : {}) };
  }
  return { ok: true, area: mission.area, lastPosition, inMission: true, tracks: state.tracks.map((t) => ({ n: t.n })) };
}

export interface ReportInput {
  session: string;
  callsign: string;
  seq: number | null;
  clientTs: number | null;
  area: AreaId;
  transcript: string;
  language: string | null;
  intent: Intent | null;
  resolution: Resolution;
  lastPosition: LastPosition | null;
  timings_ms: Timings;
}

/** A saved report: its id, and the resolution as saved, which for a track now carries its number. */
export interface SavedReport {
  id: string;
  resolution: Resolution;
}

/**
 * Saves one report, or returns null when this coordinator keeps no record or the mission ended
 * while the report was being worked out. A report sent twice (same call sign, `seq` and client
 * time) is saved once and gets the first one back. A call sign that reports without having joined
 * joins with that report.
 *
 * A report about a track gets the track's number here, inside the lock, so two phones reporting
 * at once cannot be given the same one: the number the speaker named, or the next free one.
 */
export async function saveReport(input: ReportInput, now = Date.now()): Promise<SavedReport | null> {
  const store = getStore();
  if (store.kind === "none") return null;
  return withSessionLock(input.session, async () => {
    const { entries } = await store.list(input.session);
    const mission = missionOf(entries);
    if (endOf(entries)) return null;
    if (input.seq != null && input.clientTs != null) {
      const dup = entries.find((e): e is ReportEntry => e.kind === "report" && e.callsign === input.callsign && e.seq === input.seq && e.clientTs === input.clientTs);
      if (dup) return { id: dup.id, resolution: dup.resolution };
    }
    if (mission && !joinedAlready(entries, input.callsign)) {
      const join: JoinEntry = {
        kind: "join",
        id: newEntryId(now),
        session: input.session,
        callsign: input.callsign,
        ts: now,
        device: null,
        position: mission.start ? startPosition(mission.start) : null,
      };
      await store.append(join);
    }
    let resolution = input.resolution;
    let track: TrackSighting | null = null;
    const t = resolution.track;
    // A report that could not be placed opens no track: there is nothing to number yet.
    if (t && resolution.status !== "unresolved") {
      const n = t.n ?? Math.max(0, ...entries.map((e) => (e.kind === "report" && e.track ? e.track.n : 0))) + 1;
      resolution = input.intent ? withTrackNumber(resolution, n, input.intent) : { ...resolution, track: { ...t, n } };
      const from = input.lastPosition;
      track = {
        n,
        affiliation: t.affiliation,
        kind: t.kind,
        count: t.count,
        text: t.text,
        heading: t.heading,
        position: t.placement ? positionFromPlacement(t.placement, t.label ?? "position") : null,
        from: from ? { lat: from.lat, lon: from.lon } : null,
      };
    }
    // A report about a track never moves the speaker.
    const position = t ? null : positionFromReport(resolution, input.intent);
    const entry: ReportEntry = { kind: "report", id: newEntryId(now), ts: now, ...input, resolution, position, ...(track ? { track } : {}) };
    await store.append(entry);
    return { id: entry.id, resolution };
  });
}

/** As `saveReport`, for callers that only need the report's id. */
export async function recordReport(input: ReportInput, now = Date.now()): Promise<string | null> {
  return (await saveReport(input, now))?.id ?? null;
}

function joinedAlready(entries: LogEntry[], callsign: string): boolean {
  return entries.some((e) => (e.kind === "join" || e.kind === "report") && e.callsign === callsign);
}

export type AnswerResult = { ok: true; entry: AnswerEntry } | Refusal;

/** Saves the speaker's answer to a question: a candidate id, or null for "none of these". */
export async function recordAnswer(session: string, reportId: string, choice: string | null, now = Date.now()): Promise<AnswerResult> {
  const store = getStore();
  if (store.kind === "none") return { ok: false, status: 501, error: "This coordinator keeps no record of reports." };
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    const report = entries.find((e): e is ReportEntry => e.kind === "report" && e.id === reportId);
    if (!report) return { ok: false, status: 404, error: "No such report in this session." };
    // Answered already: the first answer stands, and the phone gets it back.
    const earlier = entries.find((e): e is AnswerEntry => e.kind === "answer" && e.report_id === reportId);
    if (earlier) return { ok: true, entry: earlier };
    if (endOf(entries)) return ENDED;
    let position = null;
    // A question about a track: the choice places the track, and the speaker stays where they are.
    let track: AnswerEntry["track"] = report.track ? { n: report.track.n, position: null } : null;
    if (choice !== null) {
      const c = report.resolution.status === "ambiguous" ? report.resolution.candidates.find((x) => x.id === choice) : undefined;
      if (!c) return { ok: false, status: 400, error: "That choice was not offered." };
      if (track) track = { n: track.n, position: c.track_placement ? positionFromPlacement(c.track_placement, c.name) : null };
      else position = positionFromPlacement(c.placement, c.name);
    }
    const entry: AnswerEntry = { kind: "answer", id: newEntryId(now), session, callsign: report.callsign, ts: now, report_id: reportId, choice, position, ...(track ? { track } : {}) };
    await store.append(entry);
    return { ok: true, entry };
  });
}
