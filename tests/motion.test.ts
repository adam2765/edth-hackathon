import { describe, expect, it } from "vitest";
import { easeOut, flowDots, Slides, steppedOn } from "../components/motion";

const A = { lat: 48.8475, lon: 2.4395 };
const B = { lat: 48.8485, lon: 2.4415 };
const C = { lat: 48.8465, lon: 2.4435 };
const places = (p: Record<string, { lat: number; lon: number }>) => new Map(Object.entries(p));

describe("flowDots: the dots along a unit's arrow", () => {
  it("puts one dot every gap, from the start towards the end", () => {
    const dots = flowDots({ x: 0, y: 0 }, { x: 50, y: 0 }, 10, 0);
    expect(dots.map((d) => d.x)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(dots.every((d) => d.y === 0)).toBe(true);
  });

  it("moves every dot towards the end as the phase grows, and a whole phase is the same picture", () => {
    const at = (phase: number) => flowDots({ x: 0, y: 0 }, { x: 0, y: -40 }, 10, phase).map((d) => Math.round(d.y * 10) / 10);
    expect(at(0.25)).toEqual([-2.5, -12.5, -22.5, -32.5]);
    expect(at(0.5)[0]).toBeLessThan(at(0.25)[0]);
    expect(at(1)).toEqual(at(0));
  });

  it("keeps clear of the start, where the unit's marker is", () => {
    const dots = flowDots({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 0, 12);
    expect(Math.min(...dots.map((d) => d.x))).toBe(12);
  });

  it("draws nothing on a shaft shorter than the marker, or with no gap", () => {
    expect(flowDots({ x: 0, y: 0 }, { x: 8, y: 0 }, 10, 0, 12)).toEqual([]);
    expect(flowDots({ x: 0, y: 0 }, { x: 80, y: 0 }, 0, 0)).toEqual([]);
  });

  it("stays on the line for a slanted shaft", () => {
    for (const d of flowDots({ x: 10, y: 10 }, { x: 110, y: 60 }, 14, 0.3)) expect(d.y - 10).toBeCloseTo((d.x - 10) / 2, 6);
  });
});

describe("steppedOn: a step of the clock, or a jump", () => {
  it("is a step when the same mission and clock went on a little", () => {
    expect(steppedOn({ key: "m1:live", t: 1000 }, { key: "m1:live", t: 2000 }, 2000)).toBe(true);
  });

  it("is a jump at first sight, for another mission, for live to replay, and for a long way along the bar", () => {
    expect(steppedOn(null, { key: "m1:live", t: 2000 }, 2000)).toBe(false);
    expect(steppedOn({ key: "m1:live", t: 1000 }, { key: "m2:live", t: 2000 }, 2000)).toBe(false);
    expect(steppedOn({ key: "m1:live", t: 1000 }, { key: "m1:replay", t: 1000 }, 2000)).toBe(false);
    expect(steppedOn({ key: "m1:replay", t: 1000 }, { key: "m1:replay", t: 90_000 }, 2000)).toBe(false);
    expect(steppedOn({ key: "m1:replay", t: 90_000 }, { key: "m1:replay", t: 1000 }, 2000)).toBe(false);
  });
});

describe("Slides: a marker slides to its new place", () => {
  it("draws a marker where it is when it is first seen", () => {
    const s = new Slides();
    expect(s.retarget(places({ u: A }), 0, 600)).toBe(false);
    expect(s.at("u", 0)).toEqual(A);
  });

  it("slides from the old place to the new one, and ends exactly on it", () => {
    const s = new Slides();
    s.retarget(places({ u: A }), 0, 600);
    expect(s.retarget(places({ u: B }), 1000, 600)).toBe(true);
    expect(s.at("u", 1000)).toEqual(A);
    const mid = s.at("u", 1300)!;
    expect(mid.lat).toBeGreaterThan(A.lat);
    expect(mid.lat).toBeLessThan(B.lat);
    expect(s.active(1300)).toBe(true);
    expect(s.at("u", 1600)).toEqual(B);
    expect(s.active(1600)).toBe(false);
  });

  it("is never drawn outside the leg between the two places", () => {
    const s = new Slides();
    s.retarget(places({ u: A }), 0, 600);
    s.retarget(places({ u: B }), 0, 600);
    for (let t = 0; t <= 700; t += 50) {
      const p = s.at("u", t)!;
      expect(p.lat).toBeGreaterThanOrEqual(A.lat);
      expect(p.lat).toBeLessThanOrEqual(B.lat);
      expect(p.lon).toBeGreaterThanOrEqual(A.lon);
      expect(p.lon).toBeLessThanOrEqual(B.lon);
    }
  });

  it("jumps when told not to slide", () => {
    const s = new Slides();
    s.retarget(places({ u: A }), 0, 600);
    expect(s.retarget(places({ u: B }), 1000, 0)).toBe(false);
    expect(s.at("u", 1000)).toEqual(B);
  });

  it("goes on from where it is drawn when a second report comes during a slide", () => {
    const s = new Slides();
    s.retarget(places({ u: A }), 0, 600);
    s.retarget(places({ u: B }), 0, 600);
    const mid = s.at("u", 300)!;
    s.retarget(places({ u: C }), 300, 600);
    expect(s.at("u", 300)).toEqual(mid);
    expect(s.at("u", 900)).toEqual(C);
  });

  it("does not start again when the same places are given again", () => {
    const s = new Slides();
    s.retarget(places({ u: A }), 0, 600);
    s.retarget(places({ u: B }), 0, 600);
    const mid = s.at("u", 300)!;
    expect(s.retarget(places({ u: { ...B } }), 300, 600)).toBe(true);
    expect(s.at("u", 300)).toEqual(mid);
  });

  it("forgets a marker that left the picture: it appears, and does not slide, when it comes back", () => {
    const s = new Slides();
    s.retarget(places({ u: A, v: A }), 0, 600);
    s.retarget(places({ v: A }), 100, 600);
    expect(s.at("u", 100)).toBeNull();
    expect(s.retarget(places({ u: B, v: A }), 200, 600)).toBe(false);
    expect(s.at("u", 200)).toEqual(B);
  });

  it("slides each marker on its own", () => {
    const s = new Slides();
    s.retarget(places({ u: A, v: C }), 0, 600);
    s.retarget(places({ u: B, v: C }), 0, 600);
    expect(s.at("v", 300)).toEqual(C);
    expect(s.at("u", 300)).not.toEqual(A);
  });

  it("starts fresh after a reset", () => {
    const s = new Slides();
    s.retarget(places({ u: A }), 0, 600);
    s.reset();
    expect(s.retarget(places({ u: B }), 100, 600)).toBe(false);
    expect(s.at("u", 100)).toEqual(B);
  });
});

describe("easeOut", () => {
  it("runs from 0 to 1 and never past either end", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
