import { File } from "expo-file-system";
import { CoordinatorError } from "./mission";
import type { AreaId, Lang, Placement, Position, ReportReply, Utterance } from "./types";

export interface SendContext {
  /** Coordinator base URL, e.g. https://edth-hackathon.vercel.app or http://192.168.1.20:3117 */
  serverUrl: string;
  area: AreaId;
  /** The language the speaker uses; the question comes back in it (decision 106). */
  language: Lang;
  /** The mission this phone is on; null when the coordinator keeps no record (then nothing is saved for a command post). */
  session: string | null;
  /**
   * Sent only with no mission. In a mission the coordinator uses the sender's own last position
   * from the log [108], and the sender is known only once its call sign is read from the words.
   */
  lastPosition: Position | null;
}

export interface SendResult {
  reply: ReportReply;
  roundTripMs: number;
}

// Allow the coordinator speech and extraction timeouts to finish before the phone gives up.
const TIMEOUT_MS = 60_000;

/**
 * Sends microphone/scenario audio to the coordinator for transcription, or developer text.
 * Legacy clip fields are still accepted for compatibility with older developer clients.
 */
export async function sendUtterance(u: Utterance, ctx: SendContext): Promise<SendResult> {
  if (!ctx.session) throw new Error("Wait for a running mission before reporting.");
  const form = new FormData();
  if (u.audioUri) {
    // Expo's fetch does not take React Native's old `{ uri, name, type }` part; it takes a
    // file object from expo-file-system, which carries the file's name and type itself.
    form.append("audio", new File(u.audioUri) as unknown as Blob);
  } else if (u.text) {
    form.append("text", u.text);
  } else if (!u.clipUri) {
    throw new Error("Utterance has neither audio nor text");
  }
  if (u.clipUri && !u.audioUri) {
    form.append("clip", new File(u.clipUri) as unknown as Blob);
    form.append("segments", JSON.stringify(u.segments ?? []));
  }
  form.append("area", ctx.area);
  form.append("language", ctx.language);
  form.append("clientTs", String(u.endedAt));
  // The coordinator saves the report under this session for the command post; `seq` with the
  // client time lets it drop a report sent twice. With no call sign, a report to a mission is a
  // radio report: the coordinator reads who sent it from its words [202]. Only scenario steps name one.
  if (ctx.session) form.append("session", ctx.session);
  if (u.callsign) form.append("callsign", u.callsign);
  form.append("seq", String(u.seq));
  const p = ctx.session ? null : ctx.lastPosition;
  if (p) {
    // An estimate (from a movement report) carries its uncertainty, so "nearest wins" stays honest.
    form.append("lastPosition", JSON.stringify({ lat: p.lat, lon: p.lon, ts: p.ts, radius_m: p.radius_m, ...(p.estimated ? { uncertainty_m: p.radius_m } : {}) }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${ctx.serverUrl.replace(/\/+$/, "")}/api/report`, { method: "POST", body: form, signal: controller.signal });
    // A page that is not JSON (a proxy's error page) is read as no answer, with the HTTP status.
    const reply = ((await res.json().catch(() => null)) ?? {}) as ReportReply;
    if (!res.ok || reply.error) throw new CoordinatorError(reply.error ?? `Coordinator answered ${res.status}`, res.status, !!reply.ended);
    if (!reply.report_id && !reply.held) throw new Error("The server did not acknowledge saving this report in the mission.");
    return { reply, roundTripMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the phone is after the coordinator's placement, mirroring the web page: a stated position
 * is a fix; a movement moves it to an estimate with a wide circle. Kept quietly, and only with no
 * mission, so "200 metres north of me" has somewhere to start from.
 */
export function positionAfter(prev: Position | null, pl: Placement, label: string, now: number): Position | null {
  if (pl.heading_to) {
    if (!prev || !pl.pin) return prev;
    return { lat: pl.pin.lat, lon: pl.pin.lon, ts: now, radius_m: pl.radius_m ?? 80, label: `towards ${pl.heading_to.name}`, estimated: true };
  }
  if (pl.pin) return { lat: pl.pin.lat, lon: pl.pin.lon, ts: now, radius_m: pl.radius_m ?? 80, label, ...(pl.estimated ? { estimated: true } : {}) };
  return prev;
}
