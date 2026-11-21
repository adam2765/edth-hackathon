// Where to draw each track's symbol on the command post's map, so none hides a unit or another track.
// A track's place never changes here: only where its symbol and label are drawn, in screen
// pixels, with a thin line back to the real point. The command post runs this again after every zoom,
// because two places 100 m apart overlap at one zoom and not at the next.

/** A box on screen in pixels: left, top, right, bottom. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A track to draw: its real point on screen, and its symbol and label as boxes around that point. */
export interface Mark {
  id: string;
  x: number;
  y: number;
  /** Relative to (x, y). */
  boxes: Rect[];
}

export interface Shift {
  dx: number;
  dy: number;
}

/**
 * The directions tried, nearest first at each distance. Sideways first: a track's label sits above
 * its symbol and a unit's label below its dot, so a sideways move clears both.
 */
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0.7, -0.7],
  [-0.7, -0.7],
  [0, -1],
  [0.7, 0.7],
  [-0.7, 0.7],
  [0, 1],
];

const at = (b: Rect, x: number, y: number): Rect => ({ x0: b.x0 + x, y0: b.y0 + y, x1: b.x1 + x, y1: b.y1 + y });

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * For each track, how far to move its drawing. `fixed` are the boxes that never move: every
 * unit's dot and label. Tracks are placed in the order given, each keeping clear of the units and
 * of the tracks placed before it. A track that overlaps nothing stays on its point. Otherwise the
 * nearest spot that overlaps nothing wins, up to `rings` steps of `step` pixels away; if there is
 * none, the spot that overlaps least.
 */
export function declutter(marks: Mark[], fixed: Rect[], step: number, rings = 4): Map<string, Shift> {
  const taken = [...fixed];
  const out = new Map<string, Shift>();
  for (const m of marks) {
    const tries: Shift[] = [{ dx: 0, dy: 0 }];
    for (let r = 1; r <= rings; r++) for (const [a, b] of DIRS) tries.push({ dx: Math.round(a * step * r), dy: Math.round(b * step * r) });
    let best = tries[0];
    let least = Infinity;
    for (const s of tries) {
      let cost = 0;
      for (const b of m.boxes) {
        const box = at(b, m.x + s.dx, m.y + s.dy);
        for (const t of taken) cost += overlap(box, t);
      }
      // A tie keeps the nearer spot: the tries go outwards.
      if (cost < least) {
        best = s;
        least = cost;
      }
      if (cost === 0) break;
    }
    out.set(m.id, best);
    for (const b of m.boxes) taken.push(at(b, m.x + best.dx, m.y + best.dy));
  }
  return out;
}

/** A box of a given width and height centred on (cx, cy). */
export function centred(cx: number, cy: number, w: number, h: number): Rect {
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

/**
 * The rough size of a label on the map: its widest line at about half the font size per letter
 * (the map's bold labels measured 0.44 to 0.48 on 21 November), and its lines at 1.25. Close enough
 * to keep labels apart; the map's own fonts are not measured.
 */
export function textBox(lines: string[], size: number): { w: number; h: number } {
  const longest = Math.max(0, ...lines.map((l) => l.length));
  return { w: longest * size * 0.52, h: lines.length * size * 1.25 };
}

/**
 * Everything outside the visible map, as four boxes, so a symbol moved off a unit is not pushed
 * out of sight. `bottom` keeps clear of what lies over the map's lower edge.
 */
export function outside(w: number, h: number, bottom = 0): Rect[] {
  const far = 1e5;
  return [
    { x0: -far, y0: -far, x1: 0, y1: far },
    { x0: w, y0: -far, x1: far, y1: far },
    { x0: -far, y0: -far, x1: far, y1: 0 },
    { x0: -far, y0: h - bottom, x1: far, y1: far },
  ];
}
