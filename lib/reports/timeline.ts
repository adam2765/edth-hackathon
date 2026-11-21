/**
 * The replay bar's time line: the missions opened in one area on one day, each a stretch of time
 * from its opening to its end (or to now while it is open), with gray between them. A replay rests
 * only in a stretch: a time picked in the gray goes to the nearest start or end, and a time near a
 * start or end goes to it, like a detent. Pure; safe to import on the client.
 */
import type { MissionSummary } from "./types";

/** One mission on the bar. */
export interface Stretch {
  code: string;
  name: string;
  start: number;
  /** When it ended, or now while it is open. */
  end: number;
  open: boolean;
}

/** What the bar needs to know about the mission on screen; its own log is newer than the list. */
export type ShownMission = Pick<MissionSummary, "code" | "name" | "area" | "opened" | "ended" | "last">;

/** The local calendar day holding `ts`: from its midnight to the next. */
export function dayAround(ts: number): { from: number; to: number } {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const from = d.getTime();
  d.setDate(d.getDate() + 1);
  return { from, to: d.getTime() };
}

function stretchOf(m: ShownMission, now: number): Stretch {
  return { code: m.code, name: m.name, start: m.opened, end: m.ended ?? Math.max(m.opened, m.last, now), open: m.ended == null };
}

/**
 * The stretches on the bar, oldest first: every mission opened in the shown mission's area on the
 * day it was opened. The shown mission is always there, as its own log has it.
 */
export function dayStretches(missions: MissionSummary[], shown: ShownMission, now: number): Stretch[] {
  const { from, to } = dayAround(shown.opened);
  const out = [stretchOf(shown, now)];
  for (const m of missions) {
    if (m.code === shown.code || m.area !== shown.area || m.opened < from || m.opened >= to) continue;
    out.push(stretchOf(m, now));
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Every start and end once, in order: where the bar has its detents. */
export function detents(stretches: Stretch[]): number[] {
  return [...new Set(stretches.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
}

/** The first start and the last end. */
export function barRange(stretches: Stretch[]): { lo: number; hi: number } {
  if (!stretches.length) return { lo: 0, hi: 0 };
  return { lo: Math.min(...stretches.map((s) => s.start)), hi: Math.max(...stretches.map((s) => s.end)) };
}

/**
 * The mission running at `t`, or null in the gray. Where two overlap, `prefer` wins if it is one of
 * them (so a replay does not flip between two missions at a shared start and end), else the newer.
 */
export function stretchAt(stretches: Stretch[], t: number, prefer?: string | null): Stretch | null {
  let hit: Stretch | null = null;
  for (const s of stretches) {
    if (t < s.start || t > s.end) continue;
    if (s.code === prefer) return s;
    hit = s;
  }
  return hit;
}

/**
 * Where a time picked on the bar comes to rest. In the gray: the nearest start or end. In a
 * stretch: a start or end within `pull` ms, else the time itself. The pull is at most a quarter of
 * the stretch, so a short mission on a long day still has a middle to rest in.
 */
export function settle(stretches: Stretch[], t: number, pull: number): number {
  const ds = detents(stretches);
  if (!ds.length) return t;
  const c = Math.min(Math.max(t, ds[0]), ds[ds.length - 1]);
  const nearest = ds.reduce((best, d) => (Math.abs(d - c) < Math.abs(best - c) ? d : best), ds[0]);
  const s = stretchAt(stretches, c);
  if (!s) return nearest;
  return Math.abs(nearest - c) <= Math.min(pull, (s.end - s.start) / 4) ? nearest : c;
}

/**
 * One step along the bar: `by` ms forwards (dir 1) or back (dir -1), kept within the bar. A step
 * that lands in the gray goes on across it, to the next mission's start or the last one's end.
 */
export function stepAlong(stretches: Stretch[], t: number, dir: 1 | -1, by: number): number {
  const { lo, hi } = barRange(stretches);
  if (!stretches.length) return t;
  const n = Math.min(Math.max(t + dir * by, lo), hi);
  if (stretchAt(stretches, n)) return n;
  if (dir > 0) return Math.min(...stretches.filter((s) => s.start > n).map((s) => s.start));
  return Math.max(...stretches.filter((s) => s.end < n).map((s) => s.end));
}

/** The next start or end after `t` (dir 1) or before it (dir -1); the bar's end when there is none. */
export function nextDetent(stretches: Stretch[], t: number, dir: 1 | -1): number {
  const ds = detents(stretches);
  if (!ds.length) return t;
  if (dir > 0) return ds.find((d) => d > t) ?? ds[ds.length - 1];
  return [...ds].reverse().find((d) => d < t) ?? ds[0];
}

/** One press of an arrow key on the bar: a second. */
export const KEY_STEP_MS = 1000;

/**
 * Where a key moves the bar from `t`, or null for a key the bar leaves alone. Arrows step a second,
 * and across the gray; Page Up and Page Down go to the next or previous start or end; Home and End
 * go to the bar's ends.
 */
export function keyTarget(stretches: Stretch[], t: number, key: string): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return stepAlong(stretches, t, 1, KEY_STEP_MS);
    case "ArrowLeft":
    case "ArrowDown":
      return stepAlong(stretches, t, -1, KEY_STEP_MS);
    case "PageUp":
      return nextDetent(stretches, t, 1);
    case "PageDown":
      return nextDetent(stretches, t, -1);
    case "Home":
      return barRange(stretches).lo;
    case "End":
      return barRange(stretches).hi;
    default:
      return null;
  }
}
