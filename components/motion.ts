// Motion on the command post's map [238]. Nothing here places anything. A slide runs between two
// places the log already gave, so a marker is never drawn somewhere no report put it for longer
// than the slide. The flow along an arrow says one thing: its report is fresh and the clock on
// screen is running. Its speed is fixed and means nothing; the app knows no speed.

export interface LatLon {
  lat: number;
  lon: number;
}

/** A point on screen, in pixels. */
export interface Px {
  x: number;
  y: number;
}

/** One step of the flow along an arrow, and the steps in one cycle: 0.8 s from one band to the next. */
export const FLOW_TICK_MS = 50;
export const FLOW_STEPS = 16;
/** How long a marker takes to slide to a new place: live, and in a replay that is playing. */
export const SLIDE_MS = 600;
export const SLIDE_MS_REPLAY = 300;
/** A track is new, and gets its one ring, for this long after it was first placed. */
export const NEW_TRACK_MS = 15_000;

/** Quick at first, gentle at the end. 0 to 1 in, 0 to 1 out. */
export function easeOut(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/**
 * The dots that flow along an arrow's shaft: one every `gap` pixels from `from` towards `to`, each
 * moved on by `phase` (0 to 1) of a gap, so stepping the phase from 0 to 1 moves every dot onto the
 * next one's place. None within `skip` pixels of the start, where the unit's own marker is.
 */
export function flowDots(from: Px, to: Px, gap: number, phase: number, skip = 0): Px[] {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const len = Math.hypot(dx, dy);
  if (!(gap > 0) || !(len > skip)) return [];
  const out: Px[] = [];
  const first = skip + (((phase % 1) + 1) % 1) * gap;
  // A shaft far longer than any screen, at a close zoom: the dots beyond these are out of sight.
  for (let d = first, n = 0; d <= len && n < 2000; d += gap, n++) out.push({ x: from.x + (dx / len) * d, y: from.y + (dy / len) * d });
  return out;
}

/** The picture on screen: which mission and which clock, and the moment it stands for. */
export interface Scene {
  key: string;
  t: number;
}

/**
 * True when the picture went on by a step of its own clock. False when it jumped: another mission,
 * live to replay, a drag along the replay bar, a tab that was asleep. After a jump nothing slides,
 * because no report moved anything: the page only shows another moment.
 */
export function steppedOn(was: Scene | null, is: Scene, maxStepMs: number): boolean {
  return was != null && was.key === is.key && Math.abs(is.t - was.t) <= maxStepMs;
}

interface Move {
  from: LatLon;
  to: LatLon;
  t0: number;
  ms: number;
}

/**
 * Where each marker is drawn while it slides from its old place to its new one. The new place is
 * the truth from the moment the report came; only the drawing takes a moment to get there.
 */
export class Slides {
  private last = new Map<string, LatLon>();
  private moves = new Map<string, Move>();

  /**
   * Take the places the picture now gives, by id. A marker that was drawn before and has moved
   * slides there over `ms`. With `ms` 0 it jumps, and one not drawn before appears where it is.
   * Returns true when something is sliding.
   */
  retarget(places: Map<string, LatLon>, now: number, ms: number): boolean {
    for (const id of [...this.last.keys()]) {
      if (places.has(id)) continue;
      this.last.delete(id);
      this.moves.delete(id);
    }
    for (const [id, to] of places) {
      const was = this.last.get(id);
      if (was && was.lat === to.lat && was.lon === to.lon) continue;
      // From where it is drawn now: a second report during a slide does not throw it back.
      if (was && ms > 0) this.moves.set(id, { from: this.at(id, now) ?? was, to, t0: now, ms });
      else this.moves.delete(id);
      this.last.set(id, { lat: to.lat, lon: to.lon });
    }
    return this.active(now);
  }

  /** Where to draw it at this moment; null for a marker never given a place. */
  at(id: string, now: number): LatLon | null {
    const m = this.moves.get(id);
    if (!m) return this.last.get(id) ?? null;
    const t = (now - m.t0) / m.ms;
    if (t >= 1) {
      this.moves.delete(id);
      return m.to;
    }
    const e = easeOut(t);
    return { lat: m.from.lat + (m.to.lat - m.from.lat) * e, lon: m.from.lon + (m.to.lon - m.from.lon) * e };
  }

  /** True while any marker is still on its way. */
  active(now: number): boolean {
    for (const [id, m] of this.moves) {
      if (now - m.t0 >= m.ms) this.moves.delete(id);
    }
    return this.moves.size > 0;
  }

  /** Forget everything: the next places are drawn where they are. */
  reset(): void {
    this.last.clear();
    this.moves.clear();
  }
}
