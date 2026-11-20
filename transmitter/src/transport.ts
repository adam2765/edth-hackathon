import { File } from "expo-file-system";
import type { AreaId, Placement, Position, ReportReply, Utterance } from "./types";

export interface SendContext {
  /** Coordinator base URL, e.g. https://edth-hackathon.vercel.app or http://192.168.1.20:3117 */
  serverUrl: string;
  area: AreaId;
  session: string;
  lastPosition: Position | null;
}

export interface SendResult {
  reply: ReportReply;
  roundTripMs: number;
}

const TIMEOUT_MS = 20_000;

/** Sends one utterance to the coordinator: audio if there is a clip, otherwise the text. */
export async function sendUtterance(u: Utterance, ctx: SendContext): Promise<SendResult> {
  const form = new FormData();
  if (u.audioUri) {
    // Expo's fetch does not take React Native's old `{ uri, name, type }` part; it takes a
    // file object from expo-file-system, which carries the file's name and type itself.
    form.append("audio", new File(u.audioUri) as unknown as Blob);
  } else if (u.text) {
    form.append("text", u.text);
  } else {
    throw new Error("Utterance has neither audio nor text");
  }
  form.append("area", ctx.area);
  form.append("clientTs", String(u.endedAt));
  // The coordinator saves the report under this session and call sign for the receiver;
  // `seq` with the client time lets it drop a report sent twice.
  form.append("session", ctx.session);
  form.append("callsign", u.callsign);
  form.append("seq", String(u.seq));
  const p = ctx.lastPosition;
  if (p) {
    // An estimate (from a movement report) carries its uncertainty, so "nearest wins" stays honest.
    form.append("lastPosition", JSON.stringify({ lat: p.lat, lon: p.lon, ts: p.ts, radius_m: p.radius_m, ...(p.estimated ? { uncertainty_m: p.radius_m } : {}) }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`${ctx.serverUrl.replace(/\/+$/, "")}/api/report`, { method: "POST", body: form, signal: controller.signal });
    const reply = (await res.json()) as ReportReply;
    if (!res.ok || reply.error) throw new Error(reply.error ?? `Coordinator answered ${res.status}`);
    return { reply, roundTripMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tells the coordinator which choice the speaker tapped (a candidate id, or null for "none of
 * these"), so the receiver's question closes and the marker moves there too. The phone has already
 * applied the choice itself, so a failure is reported, not retried.
 */
export async function sendAnswer(serverUrl: string, session: string, reportId: string, choice: string | null): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session, report: reportId, choice }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Coordinator answered ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the unit is after the coordinator's placement, mirroring the web page:
 * a stated position is a fix; a movement moves the unit to an estimate with a wide circle.
 */
export function positionAfter(prev: Position | null, pl: Placement, label: string, now: number): Position | null {
  if (pl.heading_to) {
    if (!prev || !pl.pin) return prev;
    return { lat: pl.pin.lat, lon: pl.pin.lon, ts: now, radius_m: pl.radius_m ?? 80, label: `towards ${pl.heading_to.name}`, estimated: true };
  }
  if (pl.pin) return { lat: pl.pin.lat, lon: pl.pin.lon, ts: now, radius_m: pl.radius_m ?? 80, label, ...(pl.estimated ? { estimated: true } : {}) };
  return prev;
}

export function describePlacement(pl: Placement, label: string, prev: Position | null): string {
  if (pl.heading_to) {
    return prev && pl.pin ? `Moved towards ${pl.heading_to.name} (±${pl.radius_m ?? "?"} m)` : `Heading to ${pl.heading_to.name} (no starting position yet)`;
  }
  if (pl.pin) return `Placed at ${label} (±${pl.radius_m ?? 80} m)`;
  return "Nothing to place";
}
