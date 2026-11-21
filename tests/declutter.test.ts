import { describe, expect, it } from "vitest";
import { centred, declutter, outside, textBox, type Mark, type Rect } from "../components/declutter";

// The command post's sizes at scale 1: a 24 px symbol (about 36 px framed), a label above it, a unit
// dot of radius 12 with its label below.
const symbol = centred(0, 0, 36, 36);
const label = (w: number): Rect => ({ x0: -w / 2, y0: -61, x1: w / 2, y1: -26 });
const track = (id: string, x: number, y: number, labelW = 160): Mark => ({ id, x, y, boxes: [symbol, label(labelW)] });
const unit = (x: number, y: number): Rect[] => [centred(x, y, 24, 24), { x0: x - 50, y0: y + 16, x1: x + 50, y1: y + 54 }];

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
}
const placed = (m: Mark, s: { dx: number; dy: number }): Rect[] => m.boxes.map((b) => ({ x0: b.x0 + m.x + s.dx, y0: b.y0 + m.y + s.dy, x1: b.x1 + m.x + s.dx, y1: b.y1 + m.y + s.dy }));

describe("declutter: where a track's symbol is drawn", () => {
  it("leaves a track on its point when it covers nothing", () => {
    const out = declutter([track("t1", 500, 500)], unit(100, 100), 40);
    expect(out.get("t1")).toEqual({ dx: 0, dy: 0 });
  });

  it("moves a track off a unit standing on the same point, one step away", () => {
    // Track 5 "in front of the town hall", reported by BRAVO 2 who stands there. One step sideways
    // still touches the unit's label, so it goes up, clear of both.
    const fixed = unit(300, 300);
    const t = track("t5", 300, 300);
    const s = declutter([t], fixed, 40).get("t5")!;
    expect(Math.round(Math.hypot(s.dx, s.dy))).toBe(40);
    for (const b of placed(t, s)) for (const f of fixed) expect(overlaps(b, f)).toBe(false);
  });

  it("keeps a later track clear of an earlier one, label included", () => {
    // Track 3 at the church and Track 5 at the town hall, 45 px apart at this zoom: the labels collide.
    const t3 = track("t3", 255, 300);
    const t5 = track("t5", 300, 300);
    const out = declutter([t3, t5], [], 40);
    expect(out.get("t3")).toEqual({ dx: 0, dy: 0 });
    const s5 = out.get("t5")!;
    expect(s5).not.toEqual({ dx: 0, dy: 0 });
    for (const a of placed(t3, out.get("t3")!)) for (const b of placed(t5, s5)) expect(overlaps(a, b)).toBe(false);
  });

  it("with no clear spot in reach, takes the one that covers least, and never stays on top", () => {
    // Boxed in on every side up to the farthest ring.
    const wall: Rect[] = [{ x0: 0, y0: 0, x1: 1000, y1: 1000 }];
    const out = declutter([track("t1", 500, 500)], wall, 40, 2);
    expect(out.get("t1")).toEqual({ dx: 0, dy: 0 });
    // A unit dot alone is easy to clear, whatever else is near.
    const near = [...unit(500, 500), centred(560, 500, 36, 36)];
    const s = declutter([track("t2", 500, 500, 40)], near, 40).get("t2")!;
    for (const b of placed(track("t2", 500, 500, 40), s)) for (const f of near) expect(overlaps(b, f)).toBe(false);
  });

  it("sizes a label from its longest line", () => {
    expect(textBox(["T1 · hostile vehicle ×2", "10:14:35 · ALPHA 1"], 14)).toEqual({ w: 23 * 14 * 0.52, h: 2 * 14 * 1.25 });
  });

  it("does not push a symbol off the map to clear a unit at the edge", () => {
    // BRAVO 2 at the town hall, near the right edge of an 1040 px wide map; Track 5 at the same spot.
    const fixed = [...unit(1000, 400), ...outside(1040, 840, 80)];
    const t = track("t5", 1000, 400);
    const s = declutter([t], fixed, 40).get("t5")!;
    expect(s.dx).toBeLessThanOrEqual(0);
    for (const b of placed(t, s)) for (const f of fixed) expect(overlaps(b, f)).toBe(false);
  });
});
