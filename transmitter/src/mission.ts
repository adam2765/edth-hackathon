// Missions: the list of open missions on the coordinator, joining one, and what the phone keeps
// between launches (its own id and the mission it joined), so it rejoins on start.
import { File, Paths } from "expo-file-system";
import type { JoinReply, MissionListReply, Position } from "./types";

const TIMEOUT_MS = 8000;

/** A refusal the app acts on: the mission has ended, or the call sign is in use on another phone. */
export class CoordinatorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly ended = false,
    readonly taken = false,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<{ res: Response; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as T;
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

const base = (serverUrl: string) => serverUrl.replace(/\/+$/, "");

/**
 * The coordinator's missions. Null when it has no missions endpoint (an older deployment): the
 * phone then reports with no mission, as before. Throws when the coordinator does not answer.
 */
export async function fetchMissions(serverUrl: string): Promise<MissionListReply | null> {
  const { res, body } = await call<MissionListReply>(`${base(serverUrl)}/api/sessions`, { cache: "no-store" });
  return res.ok && Array.isArray(body.missions) ? body : null;
}

export async function joinMission(serverUrl: string, code: string, callsign: string, device: string): Promise<JoinReply> {
  const { res, body } = await call<JoinReply & { error?: string; ended?: boolean; taken?: boolean }>(`${base(serverUrl)}/api/sessions/${encodeURIComponent(code)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callsign, device }),
  });
  if (!res.ok) throw new CoordinatorError(body.error ?? `The coordinator answered ${res.status}.`, res.status, !!body.ended || res.status === 404, !!body.taken);
  return body;
}

/** Where the coordinator has this unit after joining, as the phone shows it. */
export function positionFromJoin(r: JoinReply): Position | null {
  const p = r.position;
  if (!p) return null;
  return { lat: p.lat, lon: p.lon, ts: r.positionTs ?? Date.now(), radius_m: p.radius_m, label: p.label, ...(p.estimated ? { estimated: true } : {}) };
}

/** Call signs as the coordinator keeps them: capitals, single spaces. */
export function callsignKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

// ---- kept on the phone ----

export interface Saved {
  /** This phone's id: one phone per call sign in a mission. */
  device: string;
  /** The mission joined, to rejoin on start. */
  joined?: { server: string; code: string; callsign: string };
}

const savedFile = () => new File(Paths.document, "transmitter.json");

function newDevice(): string {
  let id = "phone-";
  while (id.length < 22) id += Math.random().toString(36).slice(2);
  return id.slice(0, 22);
}

export function loadSaved(): Saved {
  try {
    const f = savedFile();
    if (f.exists) {
      const s = JSON.parse(f.textSync()) as Saved;
      if (typeof s.device === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(s.device)) return s;
    }
  } catch {
    // Unreadable: start again with a new id.
  }
  const s = { device: newDevice() };
  writeSaved(s);
  return s;
}

export function writeSaved(s: Saved): void {
  try {
    const f = savedFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(s)).catch(() => {});
  } catch {
    // Not saved: the phone asks to join again on its next start.
  }
}
