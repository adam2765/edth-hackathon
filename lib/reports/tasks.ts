/**
 * Recon tasking at the command post [234]: a person sends a friendly drone or drone team to look at
 * a track, ends that, or turns a unit's request down. Checking what the page sent, and whether it
 * fits the mission as the log leaves it. Pure, so it is tested without a server.
 *
 * Nothing here chooses: no range, no nearest, no ranking. The command post names the drone and the
 * track; this only refuses what cannot be (a drone that is not friendly, a track marked gone).
 */
import { canLook, RECON_KINDS, TRACK_KINDS } from "../geo/trackKinds";
import type { TrackKind } from "../geo/types";
import type { SessionState } from "./fold";
import { callsignOf, type LogEntry, type TaskAction } from "./types";

/** The drone: a friendly track by its number, or a unit on the net by its call sign [235]. */
export type Drone = { asset: number; unit?: undefined } | { unit: string; asset?: undefined };

export type TaskInput =
  | ({ action: "send"; n: number; request: string | null } & Drone)
  | ({ action: "done" } & Drone)
  | { action: "decline"; request: string };

type Parsed = { ok: true; input: TaskInput } | { ok: false; error: string };

const ACTIONS: TaskAction[] = ["send", "done", "decline"];
const ENTRY_ID = /^[a-z0-9]+-[a-z0-9]+$/;

function trackNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 9999 ? v : null;
}

function requestId(v: unknown): string | null | undefined {
  if (v == null) return null;
  return typeof v === "string" && ENTRY_ID.test(v) ? v : undefined;
}

/** Checks the shape of what the command post sent to `POST /api/sessions/<code>/tasks`. */
export function parseTask(body: unknown): Parsed {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object." };
  const b = body as Record<string, unknown>;
  const action = ACTIONS.find((a) => a === b.action);
  if (!action) return { ok: false, error: "`action` is send, done or decline." };
  const request = requestId(b.request);
  if (request === undefined) return { ok: false, error: "No such request." };
  if (action === "decline") return request ? { ok: true, input: { action, request } } : { ok: false, error: "Send `request`: the request to decline." };
  const drone = droneOf(b);
  if (typeof drone === "string") return { ok: false, error: drone };
  if (action === "done") return { ok: true, input: { action, ...drone } };
  const n = trackNumber(b.n);
  if (n == null) return { ok: false, error: "Send `n`: the track to look at." };
  return { ok: true, input: { action, ...drone, n, request } };
}

/** The drone a task names: `asset` or `unit`, exactly one. A string says what was wrong. */
function droneOf(b: Record<string, unknown>): Drone | string {
  const either = "Send `asset`, the drone or drone team's track number, or `unit`, its call sign; not both.";
  if ((b.asset == null) === (b.unit == null)) return either;
  if (b.unit != null) return typeof b.unit === "string" && b.unit.trim() ? { unit: callsignOf(b.unit) } : either;
  const asset = trackNumber(b.asset);
  return asset == null ? either : { asset };
}

/** A request is in the log, whether still open or not. */
export function requestWasMade(entries: LogEntry[], id: string): boolean {
  return entries.some((e) => e.kind === "request" && e.id === id);
}

/**
 * Whether a task fits the mission as the log leaves it. `already` when the request it answers was
 * settled by someone else first: the first decision stands. A refusal carries the HTTP status.
 */
export function checkTask(state: SessionState, entries: LogEntry[], input: TaskInput): { ok: true } | { ok: false; status: number; error: string } | { already: true } {
  const track = (n: number) => state.tracks.find((t) => t.n === n);
  if (input.action === "send" || input.action === "decline") {
    const id = input.request;
    if (id && !state.requests.some((r) => r.id === id)) {
      return requestWasMade(entries, id) ? { already: true } : { ok: false, status: 404, error: "No such request in this mission." };
    }
  }
  if (input.action === "decline") return { ok: true };
  if (input.unit != null) {
    // A unit on the net, sent because a person said what it is [235]. Its call sign proves nothing.
    const unit = state.units.find((u) => u.callsign === input.unit);
    if (!unit) return { ok: false, status: 404, error: `${input.unit} is not on this mission's net.` };
    if (input.action === "done") return unit.task ? { ok: true } : { ok: false, status: 400, error: `${input.unit} is not looking at anything.` };
    if (!unit.kind || !RECON_KINDS.includes(unit.kind)) return { ok: false, status: 400, error: `${input.unit} is not marked as a drone or drone team.` };
  } else {
    const asset = track(input.asset);
    if (!asset) return { ok: false, status: 404, error: `There is no Track ${input.asset} in this mission.` };
    if (input.action === "done") return asset.task ? { ok: true } : { ok: false, status: 400, error: `Track ${input.asset} is not looking at anything.` };
    if (!canLook(asset)) return { ok: false, status: 400, error: `Track ${input.asset} is not a friendly drone or drone team.` };
    if (asset.gone != null) return { ok: false, status: 400, error: `Track ${input.asset} is marked gone.` };
    if (input.n === input.asset) return { ok: false, status: 400, error: "A drone cannot be sent to look at itself." };
  }
  const seen = track(input.n);
  if (!seen) return { ok: false, status: 404, error: `There is no Track ${input.n} in this mission.` };
  if (seen.gone != null) return { ok: false, status: 400, error: `Track ${input.n} is marked gone.` };
  return { ok: true };
}

/** A track number the mission has: reported or placed. A request naming another is about no track. */
export function trackInLog(entries: LogEntry[], n: number): boolean {
  return entries.some((e) => (e.kind === "report" && e.track?.n === n) || (e.kind === "plot" && e.n === n));
}

// ---- what a unit is [235] ----

export type UnitInput = { callsign: string; kind: TrackKind | null };

/**
 * Checks what the command post sent to `POST /api/sessions/<code>/units`: a call sign and what the
 * unit is, one of the track kinds, or null to clear it. A person says it; nothing reads it from the
 * call sign.
 */
export function parseUnit(body: unknown): { ok: true; input: UnitInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object." };
  const b = body as Record<string, unknown>;
  if (typeof b.callsign !== "string" || !b.callsign.trim()) return { ok: false, error: "Send `callsign`: the unit." };
  const kind = b.kind === null ? null : TRACK_KINDS.find((k) => k === b.kind);
  if (kind === undefined) return { ok: false, error: `\`kind\` is one of ${TRACK_KINDS.join(", ")}, or null.` };
  return { ok: true, input: { callsign: callsignOf(b.callsign), kind } };
}

/**
 * Whether a unit's kind can change as the log leaves it. A unit looking at a track stays a drone or
 * drone team until a person ends that: changing what it is does not end a task [234].
 */
export function checkUnit(state: SessionState, roster: string[], input: UnitInput): { ok: true; same: boolean } | { ok: false; status: number; error: string } {
  if (!roster.includes(input.callsign)) return { ok: false, status: 404, error: `${input.callsign} is not on this mission's roster.` };
  const unit = state.units.find((u) => u.callsign === input.callsign);
  const drone = input.kind != null && RECON_KINDS.includes(input.kind);
  if (unit?.task && !drone) return { ok: false, status: 400, error: `${input.callsign} is looking at Track ${unit.task.n}. End that first.` };
  return { ok: true, same: (unit?.kind ?? null) === input.kind };
}
