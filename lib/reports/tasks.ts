/**
 * Recon tasking at the command post [234]: a person sends a friendly drone or drone team to look at
 * a track, ends that, or turns a unit's request down. Checking what the page sent, and whether it
 * fits the mission as the log leaves it. Pure, so it is tested without a server.
 *
 * Nothing here chooses: no range, no nearest, no ranking. The command post names the drone and the
 * track; this only refuses what cannot be (a drone that is not friendly, a track marked gone).
 */
import { canLook } from "../geo/trackKinds";
import type { SessionState } from "./fold";
import type { LogEntry, TaskAction } from "./types";

export type TaskInput =
  | { action: "send"; asset: number; n: number; request: string | null }
  | { action: "done"; asset: number }
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
  const asset = trackNumber(b.asset);
  if (asset == null) return { ok: false, error: "Send `asset`: the drone or drone team's track number." };
  if (action === "done") return { ok: true, input: { action, asset } };
  const n = trackNumber(b.n);
  if (n == null) return { ok: false, error: "Send `n`: the track to look at." };
  return { ok: true, input: { action, asset, n, request } };
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
  const asset = track(input.asset);
  if (!asset) return { ok: false, status: 404, error: `There is no Track ${input.asset} in this mission.` };
  if (input.action === "done") return asset.task ? { ok: true } : { ok: false, status: 400, error: `Track ${input.asset} is not looking at anything.` };
  if (!canLook(asset)) return { ok: false, status: 400, error: `Track ${input.asset} is not a friendly drone or drone team.` };
  if (asset.gone != null) return { ok: false, status: 400, error: `Track ${input.asset} is marked gone.` };
  if (input.n === input.asset) return { ok: false, status: 400, error: "A drone cannot be sent to look at itself." };
  const seen = track(input.n);
  if (!seen) return { ok: false, status: 404, error: `There is no Track ${input.n} in this mission.` };
  if (seen.gone != null) return { ok: false, status: 400, error: `Track ${input.n} is marked gone.` };
  return { ok: true };
}

/** A track number the mission has: reported or placed. A request naming another is about no track. */
export function trackInLog(entries: LogEntry[], n: number): boolean {
  return entries.some((e) => (e.kind === "report" && e.track?.n === n) || (e.kind === "plot" && e.n === n));
}
