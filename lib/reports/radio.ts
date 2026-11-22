/**
 * Radio reports [202]: who sent one, and when the coordinator holds it for the operator instead.
 * A phone names itself; a radio report names its sender in its words, read against the mission's
 * roster (decision 200). A transcript never creates a unit, and a report the coordinator is not
 * sure of waits in the command post's Unassigned tray [203]. Two guards [204]:
 *   - no call sign said, and one unit's question is open and recent: it is that unit's reply;
 *   - a report that would move a unit farther than 15 m/s allows [188] asks the operator first.
 * Pure; safe to import on the client.
 */
import { beforeSignOff, matchCallsign, onlyClosers, type CallsignOptions } from "../geo/callsigns";
import { distanceM } from "../geo/geo";
import type { LastPosition } from "../geo/types";
import { reachM } from "../geo/voices";
import { foldLog } from "./fold";
import { missionRoster, toLastPosition } from "./mission";
import type { HeldReason, LogEntry, Sender, UnitPosition } from "./types";

/** A reply with no call sign goes to a unit whose question was asked at most this long ago [204]. */
export const REPLY_WINDOW_MS = 2 * 60_000;

export type SenderFound =
  | { kind: "unit"; callsign: string; sender: Sender; why: string }
  | { kind: "held"; reason: HeldReason; heard: string | null; read: string | null; candidates: string[]; question: string; why: string };

const NO_WORDS = "No words heard. Listen to it, then give it to a unit or dismiss it.";

/**
 * Who a radio report is from, given the mission's log so far. A unit only when the words name one
 * roster entry, or name none while exactly one unit's question is open and recent.
 */
export function findSender(transcript: string, entries: LogEntry[], now: number, opts: CallsignOptions = {}): SenderFound {
  const roster = missionRoster(entries);
  if (!transcript.trim()) return { kind: "held", reason: "none", heard: null, read: null, candidates: [], question: NO_WORDS, why: "no words" };
  const m = matchCallsign(transcript, roster, opts);
  if (m.kind === "unit") return { kind: "unit", callsign: m.callsign, sender: { heard: m.heard, how: m.how }, why: m.why };
  if (m.kind === "ask") {
    const which = m.candidates.length === 1 ? `Was that ${m.candidates[0]}?` : `Which unit sent this: ${m.candidates.join(" or ")}?`;
    // At the end, a call sign may be a sign-off or who is spoken to [237]: the operator says which.
    const where = m.signoff ? " at the end" : "";
    return { kind: "held", reason: "which", heard: m.heard, read: null, candidates: m.candidates, question: `Heard “${m.heard}”${where}. ${which}`, why: m.why };
  }
  if (m.read) {
    const question = `${m.read} is not on the roster. Add it, or give the report to a unit.`;
    return { kind: "held", reason: "unknown", heard: m.heard, read: m.read, candidates: [], question, why: m.why };
  }
  if (m.station) return { kind: "held", reason: "none", heard: null, read: null, candidates: [], question: "This sounds like the command post calling a unit. Dismiss it, or give it to a unit.", why: m.why };

  // No call sign: the reply to an open question, if exactly one unit has one that is recent.
  const open = foldLog(entries, now).units.filter((u) => u.pending && now - u.pending.ts <= REPLY_WINDOW_MS);
  if (open.length === 1) {
    const u = open[0];
    return { kind: "unit", callsign: u.callsign, sender: { heard: null, how: "reply" }, why: `no call sign; ${u.callsign}'s question is open, asked ${Math.round((now - u.pending!.ts) / 1000)} s ago` };
  }
  if (open.length > 1) {
    const names = open.map((u) => u.callsign);
    return { kind: "held", reason: "which", heard: null, read: null, candidates: names, question: `No call sign. A reply to ${names.join(" or ")}?`, why: `no call sign; ${names.length} units have an open question` };
  }
  return { kind: "held", reason: "none", heard: null, read: null, candidates: [], question: "No call sign heard. Which unit sent this?", why: m.why };
}

/**
 * The words after the sender's call sign, for the model [202]: "BASE, this is CHARLIE 3, checking
 * in at the town hall" is "checking in at the town hall". With the call sign in front, the offline
 * model read "Charlie 3, checking in, at the town hall." as a sighting of something else. The log
 * keeps all the words. `heard` is the call sign as the reader rebuilt it ("Alpha-1" is "Alpha 1"),
 * so it is found word by word. The whole transcript when there is no call sign, or it is not found.
 *
 * A call sign said last, as a sign-off [237], leaves the words before it: "At the town hall, Alpha
 * 1, over" is "At the town hall". It is told by what follows the call sign: nothing, or only
 * closing words.
 */
export function afterCallsign(transcript: string, heard: string | null): string {
  if (!heard) return transcript;
  const words = heard.split(" ").filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return transcript;
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[^\\p{L}\\p{N}]*")}(?![\\p{L}\\p{N}])`, "u").exec(transcript);
  if (!m) return transcript;
  const rest = transcript.slice(m.index + m[0].length).replace(/^[^\p{L}\p{N}]+/u, "");
  if (onlyClosers(rest)) {
    const before = beforeSignOff(transcript.slice(0, m.index));
    if (before) return before;
  }
  return withoutClosing(rest) || rest || transcript;
}

/** "over", and after a pause "out", "standing by", «прийом» and Whisper's "Thank you." for trailing silence. */
const CLOSING =
  /(?:(?<=[,.;:!?…—–]\s*)(?:over and out|over|out|standing by|listening|thank you|thanks|termin[ée]|à vous|parlez|merci|прийом|приём|прием|кінець зв['’ʼ]?язку|конец связи|дякую)|(?<![\p{L}\p{N}])over(?: and out)?)[\s.!?,]*$/iu;

/**
 * The words without the ones that close a transmission [237]: "at Vincennes station, over." is "at
 * Vincennes station". They say nothing about a place, and left in, the offline model read "at
 * Vincennes station, over" as no position at all. "out" and the rest go only after a pause, so
 * "moving out" keeps its words. "over" goes with or without one, since Whisper often writes no
 * comma before it; "crossing over" at the very end loses its last word. Empty when nothing else
 * was said.
 */
export function withoutClosing(text: string): string {
  let out = text;
  while (CLOSING.test(out)) out = out.replace(CLOSING, "").replace(/[\s,;:—–-]+$/u, "");
  return out === text ? text : out.trim();
}

export interface FarMove {
  /** Metres from the unit's last position to where the report would put it. */
  dist: number;
  secs: number;
  /** Other units this report fits: ones that could have reached that place, nearest first. */
  others: string[];
  question: string;
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const span = (s: number) => (s < 120 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/**
 * Null when the move is one the unit could have made: within 15 m/s of its last position, plus that
 * position's uncertainty and 100 m [188]. A unit still at the start point, or never placed, has
 * no fix to measure from, so any first place passes. Otherwise, what the operator is asked.
 */
export function farMove(
  entries: LogEntry[],
  callsign: string,
  last: LastPosition | null,
  atStart: boolean,
  to: UnitPosition | null,
  now: number,
): FarMove | null {
  if (!last || atStart || !to) return null;
  const dist = distanceM(last, to);
  if (dist <= reachM(last, now)) return null;
  const secs = Math.max(0, now - last.ts) / 1000;
  const roster = new Set(missionRoster(entries));
  const others = foldLog(entries, now)
    .units.filter((u) => u.callsign !== callsign && roster.has(u.callsign) && u.position && u.positionTs != null && !u.atStart)
    .map((u) => ({ c: u.callsign, d: distanceM(u.position!, to), reach: reachM(toLastPosition(u.position!, u.positionTs!), now) }))
    .filter((x) => x.d <= x.reach)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);
  const ask = others.length ? `Was that ${others.join(" or ")}?` : "Is that right?";
  return { dist, secs, others, question: `${callsign} moved ${km(dist)} in ${span(secs)}. ${ask}` };
}
