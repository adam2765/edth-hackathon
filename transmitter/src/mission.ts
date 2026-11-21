// Missions: the list of open missions on the coordinator, and the one this phone is on, kept
// between launches. A phone does not join: like a radio tuned to a net, it sends its reports to
// the mission's code, and the coordinator reads who spoke from the words [202].
import { File, Paths } from "expo-file-system";
import type { MissionListReply } from "./types";

const TIMEOUT_MS = 8000;

/** A refusal the app acts on: `ended` when the mission has ended or is gone. */
export class CoordinatorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly ended = false,
  ) {
    super(message);
  }
}

const base = (serverUrl: string) => serverUrl.replace(/\/+$/, "");

/**
 * The coordinator's missions. Null when it has no missions endpoint (an older deployment): the
 * phone then reports with no mission, as before. Throws when the coordinator does not answer.
 */
export async function fetchMissions(serverUrl: string): Promise<MissionListReply | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base(serverUrl)}/api/sessions`, { cache: "no-store", signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as MissionListReply;
    return res.ok && Array.isArray(body.missions) ? body : null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- kept on the phone ----

export interface Saved {
  /** The mission this phone is on, and the coordinator it is on: picked again on start. */
  mission?: { server: string; code: string };
}

const savedFile = () => new File(Paths.document, "transmitter.json");

export function loadSaved(): Saved {
  try {
    const f = savedFile();
    if (!f.exists) return {};
    // `joined` is what a phone that joined kept before [114]: its code still picks the mission.
    const s = JSON.parse(f.textSync()) as { mission?: unknown; joined?: unknown };
    const m = (s.mission ?? s.joined) as { server?: unknown; code?: unknown } | undefined;
    if (m && typeof m.server === "string" && typeof m.code === "string") return { mission: { server: m.server, code: m.code } };
  } catch {
    // Unreadable: start with no mission.
  }
  return {};
}

export function writeSaved(s: Saved): void {
  try {
    const f = savedFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(s)).catch(() => {});
  } catch {
    // Not saved: the phone offers the open missions on its next start.
  }
}
