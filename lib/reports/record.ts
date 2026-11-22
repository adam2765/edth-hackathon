/**
 * Saving to the shared record: missions, joins, reports, answers, the command post's plots and
 * ends, a unit it placed by hand, radio reports held for the operator and what the operator did
 * with them. Server only.
 */
import type { AreaId } from "@/lib/geo/areas";
import { loadGazetteer } from "@/lib/geo/gazetteer";
import type { Intent, LastPosition, Resolution } from "@/lib/geo/types";
import { withTrackNumber, type KnownTrack } from "../geo/tracks";
import { FADE_AFTER_MS, foldLog, headingOf } from "./fold";
import { endOf, missionOf, missionRoster, sortMissions, startPosition, summarizeMission, toLastPosition } from "./mission";
import { nextTrackNumber, plotPosition, type FixInput, type PlotInput } from "./plot";
import { positionFromPlacement, positionFromReport } from "./position";
import { AUDIO_FILE, getStore, newEntryId, withSessionLock } from "./store";
import { checkTask, checkUnit, trackInLog, type TaskInput, type UnitInput } from "./tasks";
import type {
  AnswerEntry,
  DismissEntry,
  EndEntry,
  FixEntry,
  HeardHow,
  HeldEntry,
  HeldReason,
  JoinEntry,
  JoinReply,
  LogEntry,
  MissionEntry,
  MissionListReply,
  MissionSummary,
  PlotEntry,
  ReplyEntry,
  ReportEntry,
  RequestEntry,
  RequestReply,
  RosterEntry,
  Sender,
  TaskEntry,
  UnitEntry,
  StartPoint,
  Timings,
  TrackSighting,
  UnitPosition,
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
  input: { area: AreaId; name: string; start: StartPoint | null; roster?: string[] },
  now = Date.now(),
): Promise<{ ok: true; mission: MissionSummary } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  const { used } = await store.sessions();
  const re = new RegExp(`^${input.area}-(\\d+)$`);
  let n = Math.max(0, ...used.map((c) => Number(re.exec(c)?.[1] ?? 0))) + 1;
  for (let tries = 0; tries < 50; tries++, n++) {
    const { roster, ...rest } = input;
    const entry: MissionEntry = { kind: "mission", id: newEntryId(now), session: `${input.area}-${n}`, ts: now, ...rest, ...(roster?.length ? { roster } : {}) };
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

/**
 * What a report in a session works with: the mission's area, the unit's last position from the log,
 * and whether that is only the start point (an assumption, not a fix) or nothing at all.
 */
export type ReportContext = { ok: true; area: AreaId; lastPosition: LastPosition | null; atStart: boolean; inMission: boolean; tracks: KnownTrack[] };

/**
 * For a report to a mission: refuses an unknown or ended mission, and gives the area and the
 * speaker's last position from the log (their latest fix, else the start point). The phone's own
 * `lastPosition` is then ignored, so the command post and the resolver agree on where a unit is.
 * With no record kept, the phone's area and position are used as before.
 * It also lists the mission's tracks, so a number the speaker says ("Track 3") can be checked.
 */
export async function reportContext(
  session: string,
  callsign: string,
  fallback: { area: AreaId; lastPosition: LastPosition | null },
  now = Date.now(),
  /** For a held report given to a unit later: the unit as it was when the report came in [203]. */
  upTo = Number.POSITIVE_INFINITY,
): Promise<ReportContext | Refusal> {
  const store = getStore();
  if (store.kind === "none") return { ok: true, ...fallback, atStart: false, inMission: false, tracks: [] };
  const { entries } = await store.list(session);
  const mission = missionOf(entries);
  if (!mission) return NO_MISSION;
  if (endOf(entries)) return ENDED;
  const state = foldLog(entries, upTo);
  const u = state.units.find((x) => x.callsign === callsign);
  let lastPosition: LastPosition | null = null;
  if (u?.position && u.positionTs != null) {
    // The street and the way it was going let "the next crossing" be found (decision 117).
    const heading = headingOf(u);
    lastPosition = { ...toLastPosition(u.position, u.positionTs), ...(u.street ? { street: u.street } : {}), ...(heading != null ? { heading_deg: heading } : {}) };
  } else if (mission.start) {
    lastPosition = { ...toLastPosition(startPosition(mission.start), now), ...(mission.start.category === "street" ? { street: mission.start.id } : {}) };
  }
  const atStart = !u?.position || u.atStart;
  return { ok: true, area: mission.area, lastPosition, atStart, inMission: true, tracks: state.tracks.map((t) => ({ n: t.n })) };
}

/** An open mission's log, for a radio report: who is on the roster, which questions are open. */
export async function openMissionLog(session: string): Promise<{ ok: true; area: AreaId; entries: LogEntry[] } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  const { entries } = await store.list(session);
  const mission = missionOf(entries);
  if (!mission) return NO_MISSION;
  if (endOf(entries)) return ENDED;
  return { ok: true, area: mission.area, entries };
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
  /** A radio report: how its sender was found [202]. Its call sign must be on the roster. */
  sender?: Sender;
  /** A request for recon said with the report, cut out of the words the model read [234]. Saved as its own entry. */
  request?: { words: string; n: number | null };
  /** The words the model read, when they differ from the transcript other than by the call sign: said back from these. */
  read?: string;
}

/** A saved report: its id, and the resolution as saved, which for a track now carries its number. */
export interface SavedReport {
  id: string;
  resolution: Resolution;
  /** The request for recon saved with it [234]. */
  request?: RequestReply;
  /** A held report someone had given to a unit, or dismissed, already: nothing new was saved [203]. */
  already?: boolean;
}

/** The report a held one became, or its dismissal; undefined while it waits. */
function settledHeld(entries: LogEntry[], held: string): ReportEntry | DismissEntry | undefined {
  return entries.find((e): e is ReportEntry | DismissEntry => (e.kind === "report" && e.sender?.held === held) || (e.kind === "dismiss" && e.held === held));
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
export async function saveReport(full: ReportInput, now = Date.now()): Promise<SavedReport | null> {
  const store = getStore();
  if (store.kind === "none") return null;
  // The request is an entry of its own, and the words read are only for saying back.
  const { request, read, ...input } = full;
  return withSessionLock(input.session, async () => {
    const { entries } = await store.list(input.session);
    if (endOf(entries)) return null;
    if (input.seq != null && input.clientTs != null) {
      const dup = entries.find((e): e is ReportEntry => e.kind === "report" && e.callsign === input.callsign && e.seq === input.seq && e.clientTs === input.clientTs);
      if (dup) return { id: dup.id, resolution: dup.resolution };
    }
    if (input.sender) {
      // A transcript never creates a unit: a radio report goes only to a call sign on the roster [201].
      if (!missionRoster(entries).includes(input.callsign)) throw new Error(`${input.callsign} is not on the roster of ${input.session}`);
      // A held report is settled once: the first decision stands.
      const held = input.sender.held;
      const earlier = held ? settledHeld(entries, held) : undefined;
      if (earlier) return { id: earlier.id, resolution: earlier.kind === "report" ? earlier.resolution : input.resolution, already: true };
    }
    await joinIfNew(entries, input.session, input.callsign, now);
    let resolution = input.resolution;
    let track: TrackSighting | null = null;
    const t = resolution.track;
    // A report that could not be placed opens no track: there is nothing to number yet.
    if (t && resolution.status !== "unresolved") {
      // The same count as tracks placed at the command post.
      const n = t.n ?? nextTrackNumber(entries);
      resolution = input.intent ? withTrackNumber(resolution, n, input.intent, read ?? input.transcript) : { ...resolution, track: { ...t, n } };
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
    if (!request) return { id: entry.id, resolution };
    // The request is about the track it names, else the track this report opened or saw [234].
    const n = request.n != null && trackInLog([...entries, entry], request.n) ? request.n : (track?.n ?? null);
    const asked = await appendRequest({ session: input.session, callsign: input.callsign, words: request.words, n, report_id: entry.id, sender: input.sender }, now);
    return { id: entry.id, resolution, request: { id: asked.id, n: asked.n } };
  });
}

/** A call sign that reports or asks without having joined joins with that report. Inside the lock. */
async function joinIfNew(entries: LogEntry[], session: string, callsign: string, now: number): Promise<void> {
  const mission = missionOf(entries);
  if (!mission || joinedAlready(entries, callsign)) return;
  const join: JoinEntry = {
    kind: "join",
    id: newEntryId(now),
    session,
    callsign,
    ts: now,
    device: null,
    position: mission.start ? startPosition(mission.start) : null,
  };
  await getStore().append(join);
}

async function appendRequest(r: Omit<RequestEntry, "kind" | "id" | "ts">, now: number): Promise<RequestEntry> {
  const { sender, ...rest } = r;
  const entry: RequestEntry = { kind: "request", id: newEntryId(now), ts: now, ...rest, ...(sender ? { sender } : {}) };
  await getStore().append(entry);
  return entry;
}

// ---- requests for recon and the command post's tasks [234] ----

export interface RequestInput {
  session: string;
  callsign: string;
  words: string;
  /** The track named; kept only when the mission has it. */
  n: number | null;
  sender?: Sender;
}

/**
 * Saves a request for recon that came with no report ("Track 2, request eyes on"). Null when this
 * coordinator keeps no record or the mission has ended. A radio request goes only to a call sign
 * on the roster, as a report does [201].
 */
export async function saveRequest(input: RequestInput, now = Date.now()): Promise<RequestEntry | null> {
  const store = getStore();
  if (store.kind === "none") return null;
  return withSessionLock(input.session, async () => {
    const { entries } = await store.list(input.session);
    if (!missionOf(entries) || endOf(entries)) return null;
    if (input.sender && !missionRoster(entries).includes(input.callsign)) throw new Error(`${input.callsign} is not on the roster of ${input.session}`);
    await joinIfNew(entries, input.session, input.callsign, now);
    const n = input.n != null && trackInLog(entries, input.n) ? input.n : null;
    return appendRequest({ session: input.session, callsign: input.callsign, words: input.words, n, report_id: null, sender: input.sender }, now);
  });
}

export type TaskResult = { ok: true; entry: TaskEntry | null; already: boolean } | Refusal;

/**
 * What a person at the command post did about recon [234]: sent a friendly drone or drone team to
 * look at a track, ended that, or turned a request down. Checked against the log inside the lock;
 * the first decision on a request stands.
 */
export async function recordTask(session: string, input: TaskInput, by: string, now = Date.now()): Promise<TaskResult> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    if (!missionOf(entries)) return NO_MISSION;
    if (endOf(entries)) return ENDED;
    const fits = checkTask(foldLog(entries), entries, input);
    if ("already" in fits) return { ok: true, entry: null, already: true };
    if (!fits.ok) return { ok: false, status: fits.status, error: fits.error };
    const base = { kind: "task" as const, id: newEntryId(now), session, ts: now, by };
    const drone = (d: TaskInput & { action: "send" | "done" }) => (d.unit != null ? { unit: d.unit } : { asset: d.asset });
    const entry: TaskEntry =
      input.action === "send"
        ? { ...base, action: "send", ...drone(input), n: input.n, ...(input.request ? { request: input.request } : {}) }
        : input.action === "done"
          ? { ...base, action: "done", ...drone(input) }
          : { ...base, action: "decline", request: input.request };
    await store.append(entry);
    return { ok: true, entry, already: false };
  });
}

/**
 * A person at the command post says what a unit is [235], so a drone team on the net can be sent to
 * look at a track. The same kind again writes nothing.
 */
export async function recordUnit(session: string, input: UnitInput, by: string, now = Date.now()): Promise<{ ok: true; entry: UnitEntry | null } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    if (!missionOf(entries)) return NO_MISSION;
    if (endOf(entries)) return ENDED;
    const fits = checkUnit(foldLog(entries), missionRoster(entries), input);
    if (!fits.ok) return { ok: false, status: fits.status, error: fits.error };
    if (fits.same) return { ok: true, entry: null };
    const entry: UnitEntry = { kind: "unit", id: newEntryId(now), session, ts: now, by, callsign: input.callsign, unit_kind: input.kind };
    await store.append(entry);
    return { ok: true, entry };
  });
}

// ---- radio reports held for the operator [203] ----

export interface HeldInput {
  session: string;
  clientTs: number | null;
  area: AreaId;
  transcript: string;
  language: string | null;
  reason: HeldReason;
  heard: string | null;
  read: string | null;
  candidates: string[];
  question: string;
  position?: UnitPosition | null;
  /** The recording, kept for the operator to listen to. */
  audio: { data: Buffer; ext: string } | null;
}

/** Saves a radio report for the Unassigned tray, with its recording. Null when nothing is kept or the mission ended. */
export async function saveHeld(input: HeldInput, now = Date.now()): Promise<HeldEntry | null> {
  const store = getStore();
  if (store.kind === "none") return null;
  const id = newEntryId(now);
  const { audio, session, ...rest } = input;
  let file: string | null = null;
  if (audio) {
    const name = `${id}.${audio.ext}`;
    try {
      if (AUDIO_FILE.test(name) && (await store.saveAudio(session, name, audio.data))) file = name;
    } catch (err) {
      console.error("keeping the held report's audio failed", err);
    }
  }
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    if (!missionOf(entries) || endOf(entries)) return null;
    const entry: HeldEntry = { kind: "held", id, session, ts: now, ...rest, audio: file };
    await store.append(entry);
    return entry;
  });
}

/** A held report as the operator would settle it: the report, and whether it waits still. */
export async function heldReport(session: string, held: string): Promise<{ ok: true; entry: HeldEntry; settled: ReportEntry | DismissEntry | null } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  const { entries } = await store.list(session);
  if (!missionOf(entries)) return NO_MISSION;
  const entry = entries.find((e): e is HeldEntry => e.kind === "held" && e.id === held);
  if (!entry) return { ok: false, status: 404, error: "No such held report in this mission." };
  const settled = settledHeld(entries, held) ?? null;
  if (!settled && endOf(entries)) return ENDED;
  return { ok: true, entry, settled };
}

/**
 * The operator adds a call sign to the roster [201]. Adding one that is on it already changes
 * nothing. `held` is the held report it was heard in, when it came from the tray.
 */
export async function addToRoster(session: string, callsign: string, by: string, held: string | null = null, now = Date.now()): Promise<{ ok: true; added: boolean } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    if (!missionOf(entries)) return NO_MISSION;
    if (endOf(entries)) return ENDED;
    if (missionRoster(entries).includes(callsign)) return { ok: true, added: false };
    const entry: RosterEntry = { kind: "roster", id: newEntryId(now), session, ts: now, by, callsign, ...(held ? { held } : {}) };
    await store.append(entry);
    return { ok: true, added: true };
  });
}

/** The operator dismisses a held report. Settled already: the first decision stands. */
export async function dismissHeld(session: string, held: string, by: string, now = Date.now()): Promise<{ ok: true; already: boolean } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    if (!entries.some((e) => e.kind === "held" && e.id === held)) return { ok: false, status: 404, error: "No such held report in this mission." };
    if (settledHeld(entries, held)) return { ok: true, already: true };
    if (endOf(entries)) return ENDED;
    const entry: DismissEntry = { kind: "dismiss", id: newEntryId(now), session, ts: now, by, held };
    await store.append(entry);
    return { ok: true, already: false };
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

/**
 * Saves the answer to a question: a candidate id, or null for "none of these". `by` is "CP" when
 * the command post chose for the unit; otherwise the speaker answered on the phone. The first
 * answer stands, whoever gave it.
 */
export async function recordAnswer(session: string, reportId: string, choice: string | null, now = Date.now(), by: string | null = null): Promise<AnswerResult> {
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
    // Only a question still open can be answered [241, 242]. A question with no choices ("How far east
    // is it?") can only be closed; one the unit has moved past, by reporting again, is closed already.
    const asked = foldLog(entries).feed.find((f) => f.id === reportId);
    if (!asked?.question) return { ok: false, status: 400, error: "That report asked nothing." };
    // Closed by the unit's next report [241], or by a person placing the unit by hand [243].
    if (asked.overtaken) return { ok: false, status: 409, error: asked.byHand ? `${report.callsign} has been placed by hand since, so that question is closed.` : `${report.callsign} has reported again since, so that question is closed.` };
    if (report.resolution.status !== "ambiguous" && choice !== null) return { ok: false, status: 400, error: "That question had no choices: it can only be closed." };
    let position = null;
    // A question about a track: the choice places the track, and the speaker stays where they are.
    let track: AnswerEntry["track"] = report.track ? { n: report.track.n, position: null } : null;
    if (choice !== null) {
      const c = report.resolution.status === "ambiguous" ? report.resolution.candidates.find((x) => x.id === choice) : undefined;
      if (!c) return { ok: false, status: 400, error: "That choice was not offered." };
      if (track) track = { n: track.n, position: c.track_placement ? positionFromPlacement(c.track_placement, c.name) : null };
      else position = positionFromPlacement(c.placement, c.name);
    }
    const entry: AnswerEntry = {
      kind: "answer",
      id: newEntryId(now),
      session,
      callsign: report.callsign,
      ts: now,
      report_id: reportId,
      choice,
      position,
      ...(track ? { track } : {}),
      ...(by ? { by } : {}),
    };
    await store.append(entry);
    return { ok: true, entry };
  });
}

// ---- an answer heard for an open question ----

export interface ReplyInput {
  session: string;
  callsign: string;
  clientTs: number | null;
  /** The report whose question the words answer. */
  report_id: string;
  transcript: string;
  language: string | null;
  /** The choice heard: a candidate id of that question. */
  choice: string;
  how: HeardHow;
  sender?: Sender;
}

/**
 * Keeps what a unit said as an answer heard for its open question [245]. It moves nothing: the
 * command post confirms the choice. Null when that question is no longer the unit's open one, or
 * the choice is not one of its own (answered, closed or overtaken while the clip was read, or the
 * mission ended): the caller then reads the words as a report.
 */
export async function saveReply(input: ReplyInput, now = Date.now()): Promise<ReplyEntry | null> {
  const store = getStore();
  if (store.kind === "none") return null;
  return withSessionLock(input.session, async () => {
    const { entries } = await store.list(input.session);
    if (!missionOf(entries) || endOf(entries)) return null;
    const pending = foldLog(entries).units.find((u) => u.callsign === input.callsign)?.pending;
    if (pending?.reportId !== input.report_id || !pending.candidates.some((c) => c.id === input.choice)) return null;
    const entry: ReplyEntry = {
      kind: "reply",
      id: newEntryId(now),
      session: input.session,
      callsign: input.callsign,
      ts: now,
      clientTs: input.clientTs,
      report_id: input.report_id,
      transcript: input.transcript,
      language: input.language,
      choice: input.choice,
      how: input.how,
      ...(input.sender ? { sender: input.sender } : {}),
    };
    await store.append(entry);
    return entry;
  });
}

// ---- a unit placed by hand at the command post ----

/**
 * Saves where a person at the command post put a unit [243]: a click on the map, or a place picked
 * by name, checked against the mission's area and named from the gazetteer, as for a track. Only a
 * unit on the roster: placing never makes a unit, as a transcript never does [200]. The unit's own
 * question about where it is closes with it; the fold does that.
 */
export async function recordFix(session: string, input: FixInput, by: string, now = Date.now()): Promise<{ ok: true; entry: FixEntry } | Refusal> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    const mission = missionOf(entries);
    if (!mission) return NO_MISSION;
    if (endOf(entries)) return ENDED;
    if (!missionRoster(entries).includes(input.callsign)) return { ok: false, status: 404, error: `${input.callsign} is not on this mission's roster.` };
    const position = plotPosition(input.where, input.radius_m, mission.area, loadGazetteer(mission.area));
    if (typeof position === "string") return { ok: false, status: 400, error: position };
    const entry: FixEntry = { kind: "fix", id: newEntryId(now), session, ts: now, by, callsign: input.callsign, position, note: input.note };
    await store.append(entry);
    return { ok: true, entry };
  });
}

// ---- the command post's own changes to tracks ----

export type PlotResult = { ok: true; entry: PlotEntry } | Refusal;

/**
 * Saves what a person at the command post did to a track: placed one, changed whose or what it
 * is, moved it, marked it gone or brought it back. A new track gets its number here, inside the
 * lock, from the same count as reported tracks. The position comes from the person (a click, or a
 * place picked by name), is checked against the mission's area, and is named from the gazetteer.
 */
export async function recordPlot(session: string, input: PlotInput, by: string, now = Date.now()): Promise<PlotResult> {
  const store = getStore();
  if (store.kind === "none") return NO_RECORD;
  return withSessionLock(session, async () => {
    const { entries } = await store.list(session);
    const mission = missionOf(entries);
    if (!mission) return NO_MISSION;
    if (endOf(entries)) return ENDED;
    const base = { kind: "plot" as const, id: newEntryId(now), session, ts: now, by };
    let entry: PlotEntry;
    if (input.action === "place") {
      const position = plotPosition(input.where, input.radius_m, mission.area, loadGazetteer(mission.area));
      if (typeof position === "string") return { ok: false, status: 400, error: position };
      entry = { ...base, action: "place", n: nextTrackNumber(entries), affiliation: input.affiliation, track_kind: input.track_kind, count: input.count, position, note: input.note };
    } else {
      if (!foldLog(entries).tracks.some((t) => t.n === input.n)) return { ok: false, status: 404, error: `There is no Track ${input.n} in this mission.` };
      if (input.action === "edit") {
        entry = { ...base, action: "edit", n: input.n, affiliation: input.affiliation, track_kind: input.track_kind, count: input.count, note: input.note };
      } else if (input.action === "move") {
        const position = plotPosition(input.where, input.radius_m, mission.area, loadGazetteer(mission.area));
        if (typeof position === "string") return { ok: false, status: 400, error: position };
        entry = { ...base, action: "move", n: input.n, position, note: input.note };
      } else {
        entry = { ...base, action: input.action, n: input.n };
      }
    }
    await store.append(entry);
    return { ok: true, entry };
  });
}
