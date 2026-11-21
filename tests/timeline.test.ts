import { describe, expect, it } from "vitest";
import { barRange, dayAround, dayStretches, detents, keyTarget, nextDetent, settle, stepAlong, stretchAt, type Stretch } from "@/lib/reports/timeline";
import type { MissionSummary } from "@/lib/reports/types";

const MIN = 60_000;
// 10:00 on a day, local time, as the command post's browser has it.
const day = new Date(2026, 10, 21, 10, 0, 0).getTime();
const at = (min: number) => day + min * MIN;

function mission(code: string, opened: number, ended: number | null, area: MissionSummary["area"] = "vincennes"): MissionSummary {
  return { code, name: code, area, start: null, roster: [], opened, ended, units: 0, reports: 0, last: ended ?? opened };
}

describe("dayStretches", () => {
  const list = [
    mission("vincennes-13", at(0), at(12)),
    mission("vincennes-14", at(24), at(28)),
    mission("kyiv-2", at(30), at(40), "kyiv"),
    mission("vincennes-15", at(28), null),
    // The day before, and the day after.
    mission("vincennes-3", at(-24 * 60), at(-24 * 60 + 30)),
    mission("vincennes-30", at(24 * 60), null),
  ];

  it("takes the missions opened in the shown one's area on its day, oldest first", () => {
    const s = dayStretches(list, list[1], at(50));
    expect(s.map((x) => x.code)).toEqual(["vincennes-13", "vincennes-14", "vincennes-15"]);
  });

  it("runs an open mission to now", () => {
    const s = dayStretches(list, list[1], at(50));
    expect(s[2]).toMatchObject({ start: at(28), end: at(50), open: true });
  });

  it("takes the shown mission from its own log, not the list", () => {
    const shown = { ...list[3], ended: at(45) };
    const s = dayStretches(list, shown, at(50));
    expect(s.find((x) => x.code === "vincennes-15")).toMatchObject({ end: at(45), open: false });
  });

  it("has the shown mission even when the list does not", () => {
    const s = dayStretches([], list[0], at(50));
    expect(s).toEqual([{ code: "vincennes-13", name: "vincennes-13", start: at(0), end: at(12), open: false }]);
  });

  it("knows the day by local midnight", () => {
    const { from, to } = dayAround(at(0));
    expect(new Date(from).getHours()).toBe(0);
    expect(to - from).toBeGreaterThanOrEqual(23 * 60 * MIN);
  });
});

describe("on the bar", () => {
  const s: Stretch[] = [
    { code: "a", name: "a", start: at(0), end: at(10), open: false },
    { code: "b", name: "b", start: at(20), end: at(30), open: false },
    { code: "c", name: "c", start: at(30), end: at(60), open: true },
  ];

  it("has a detent at every start and end, once", () => {
    expect(detents(s)).toEqual([at(0), at(10), at(20), at(30), at(60)]);
    expect(barRange(s)).toEqual({ lo: at(0), hi: at(60) });
  });

  it("finds the mission running at a time, and none in the gray", () => {
    expect(stretchAt(s, at(5))?.code).toBe("a");
    expect(stretchAt(s, at(15))).toBeNull();
    // b ends as c starts: the one on screen stays.
    expect(stretchAt(s, at(30), "b")?.code).toBe("b");
    expect(stretchAt(s, at(30), "c")?.code).toBe("c");
  });

  it("does not rest in the gray: it goes to the nearest start or end", () => {
    expect(settle(s, at(12), MIN)).toBe(at(10));
    expect(settle(s, at(18), MIN)).toBe(at(20));
    expect(settle(s, at(-5), MIN)).toBe(at(0));
    expect(settle(s, at(70), MIN)).toBe(at(60));
  });

  it("is pulled onto a start or end nearby, and rests anywhere else in a mission", () => {
    expect(settle(s, at(9.5), MIN)).toBe(at(10));
    expect(settle(s, at(20.8), MIN)).toBe(at(20));
    expect(settle(s, at(25), MIN)).toBe(at(25));
  });

  it("keeps the middle of a short mission free when the pull is wide", () => {
    // A 10-minute mission and a pull of 9 minutes: only its outer quarters pull.
    expect(settle(s, at(5), 9 * MIN)).toBe(at(5));
    expect(settle(s, at(8), 9 * MIN)).toBe(at(10));
  });

  it("steps across the gray in the way it is going", () => {
    expect(stepAlong(s, at(10), 1, 1000)).toBe(at(20));
    expect(stepAlong(s, at(20), -1, 1000)).toBe(at(10));
    expect(stepAlong(s, at(5), 1, 1000)).toBe(at(5) + 1000);
    expect(stepAlong(s, at(60), 1, 1000)).toBe(at(60));
    expect(stepAlong(s, at(0), -1, 1000)).toBe(at(0));
  });

  it("jumps from detent to detent", () => {
    expect(nextDetent(s, at(5), 1)).toBe(at(10));
    expect(nextDetent(s, at(10), 1)).toBe(at(20));
    expect(nextDetent(s, at(20), -1)).toBe(at(10));
    expect(nextDetent(s, at(60), 1)).toBe(at(60));
    expect(nextDetent(s, at(0), -1)).toBe(at(0));
  });

  it("moves with the keys, and leaves other keys alone", () => {
    expect(keyTarget(s, at(10), "ArrowRight")).toBe(at(20));
    expect(keyTarget(s, at(5), "ArrowLeft")).toBe(at(5) - 1000);
    expect(keyTarget(s, at(5), "PageUp")).toBe(at(10));
    expect(keyTarget(s, at(25), "PageDown")).toBe(at(20));
    expect(keyTarget(s, at(25), "Home")).toBe(at(0));
    expect(keyTarget(s, at(25), "End")).toBe(at(60));
    expect(keyTarget(s, at(25), "Tab")).toBeNull();
  });
});
