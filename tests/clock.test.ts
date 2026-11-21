import { describe, expect, it } from "vitest";
import { clockChecked, clockSaid, clocksSaid } from "../lib/geo/clock";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { bearingDeg, distanceM } from "../lib/geo/geo";
import { resolveReport } from "../lib/geo/tracks";
import type { Intent, LastPosition } from "../lib/geo/types";
import { sanitizeIntent } from "../lib/providers/extractor";

const gaz = loadGazetteer("vincennes");
const NOW = Date.parse("2026-11-21T16:06:40Z");
/** BEVERAGE's last position before "200 meters at 3 o'clock." (mission vincennes-21, report 7). */
const LAST: LastPosition = { lat: 48.849331, lon: 2.44628, ts: NOW - 3 * 60_000, radius_m: 130, uncertainty_m: 130, heading_deg: 90 };
const hours = (text: string) => clocksSaid(text).map((c) => c.hour);
const run = (raw: Record<string, unknown>, transcript: string) =>
  resolveReport({ intent: sanitizeIntent(raw, null, transcript), transcript, lastPosition: LAST, now: NOW, gazetteer: gaz, observer: "BEVERAGE" });

describe("clock directions in the words", () => {
  it("reads English clock directions, in digits or words", () => {
    expect(hours("200 meters at 3 o'clock.")).toEqual([3]);
    expect(hours("Moved three hundred metres at three o'clock")).toEqual([3]);
    expect(hours("contact 12 oclock")).toEqual([12]);
    expect(hours("drone at 11 o clock")).toEqual([11]);
    expect(hours("400 metres at 4:30 o'clock")).toEqual([4.5]);
  });

  it("reads French ones only after à", () => {
    expect(hours("200 mètres à 3 heures")).toEqual([3]);
    expect(hours("j'ai avancé de 100 mètres à trois heures")).toEqual([3]);
    expect(hours("drone à 2h, 300 mètres")).toEqual([2]);
    expect(hours("à 4h30, 200 mètres")).toEqual([4.5]);
    expect(hours("véhicule à midi")).toEqual([12]);
    expect(hours("j'ai marché 3 heures")).toEqual([]);
  });

  it("reads Ukrainian and Russian ones only after на", () => {
    expect(hours("пройшов 200 метрів на 3 години")).toEqual([3]);
    expect(hours("дрон на третю годину, триста метрів")).toEqual([3]);
    expect(hours("на дев'яту годину")).toEqual([9]);
    expect(hours("танк на три часа")).toEqual([3]);
    expect(hours("ішли 3 години")).toEqual([]);
  });

  it("a number alone, or past twelve, is not a clock direction", () => {
    expect(hours("at 3, moving east")).toEqual([]);
    expect(hours("13 o'clock")).toEqual([]);
    expect(hours("Moved 300 metres north")).toEqual([]);
  });

  it("12 o'clock is north and each hour is 30°; the compass point is the nearest of eight", () => {
    const at = (h: string) => clockSaid(`at ${h} o'clock`)!;
    expect(at("12")).toMatchObject({ deg: 0, direction: "north" });
    expect(at("3")).toMatchObject({ deg: 90, direction: "east" });
    expect(at("6")).toMatchObject({ deg: 180, direction: "south" });
    expect(at("9")).toMatchObject({ deg: 270, direction: "west" });
    expect(at("2")).toMatchObject({ deg: 60, direction: "north_east" });
    expect(at("4:30")).toMatchObject({ deg: 135, direction: "south_east" });
    expect(at("5")).toMatchObject({ deg: 150, direction: "south_east" });
    expect(at("10")).toMatchObject({ deg: 300, direction: "north_west" });
  });

  it("two different clock directions are no reading; the same one twice is", () => {
    expect(clockSaid("at 3 o'clock, no, 4 o'clock")).toBeNull();
    expect(clockSaid("3 o'clock, I say again 3 o'clock")?.hour).toBe(3);
  });
});

describe("the clock overrides the model's compass reading", () => {
  const model = (o: Partial<Intent>): Intent => ({ ...sanitizeIntent({ kind: "movement", distance_m: 200, language: "en" }), ...o });

  it("sets the direction of travel", () => {
    expect(clockChecked(model({ direction: "south_east" }), "200 meters at 3 o'clock.").direction).toBe("east");
    expect(clockChecked(model({ direction: null }), "200 meters at 3 o'clock.").direction).toBe("east");
  });

  it("goes into a compass relation when the model used one", () => {
    const out = clockChecked(model({ relation: "south_east_of", direction: "south_east" }), "300 metres at 3 o'clock");
    expect(out).toMatchObject({ relation: "east_of", direction: null });
  });

  it("leaves the way out when two different ones were said", () => {
    expect(clockChecked(model({ direction: "east" }), "at 3 o'clock, no, 4 o'clock").direction).toBeNull();
  });

  it("changes nothing when no clock was said", () => {
    const i = model({ direction: "north" });
    expect(clockChecked(i, "Moved 200 metres north")).toBe(i);
  });

  it("is applied when the extractor's output is sanitised with the transcript", () => {
    const raw = { kind: "movement", distance_m: 200, direction: "south_east", language: "en", confidence: 0.85, track: null };
    expect(sanitizeIntent(raw, null, "200 meters at 3 o'clock.").direction).toBe("east");
    expect(sanitizeIntent(raw).direction).toBe("south_east");
  });
});

describe("placing a move or a track at a clock direction", () => {
  it("200 metres at 3 o'clock goes 200 m east, not south-east (the report of 21 Nov)", () => {
    // What the model sent back for this report.
    const r = run({ kind: "movement", distance_m: 200, direction: "south_east", language: "en", confidence: 0.85, track: null }, "200 meters at 3 o'clock.");
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("dead_reckoned");
    expect(Math.abs(distanceM(LAST, r.pin!) - 200)).toBeLessThan(2);
    expect(Math.abs(bearingDeg(LAST, r.pin!) - 90)).toBeLessThan(1);
  });

  it("2 o'clock is reckoned on 60°, not north-east's 45°", () => {
    const r = run({ kind: "movement", distance_m: 300, direction: "north_east", language: "en", confidence: 0.9, track: null }, "moved 300 metres at 2 o'clock");
    expect(r.evidence.rule).toBe("dead_reckoned");
    expect(Math.abs(bearingDeg(LAST, r.pin!) - 60)).toBeLessThan(1);
  });

  it("two different clock directions ask which way", () => {
    const r = run({ kind: "movement", distance_m: 200, direction: "east", language: "en", confidence: 0.9, track: null }, "200 metres at 3 o'clock, no, 4 o'clock");
    expect(r.status).toBe("unresolved");
    expect(r.evidence.rule).toBe("move_incomplete");
  });

  it("a track at 2 o'clock, 300 metres, is placed from the observer on 60°", () => {
    const transcript = "Hostile drone at 2 o'clock, 300 metres";
    const r = run(
      { kind: "position", distance_m: 300, direction: "north_east", language: "en", confidence: 0.9, track: { ref: null, kind: "drone", count: null, text: "hostile drone", heading: null } },
      transcript,
    );
    expect(r.status).toBe("resolved");
    expect(r.pin).toBeUndefined();
    const pin = r.track!.placement!.pin!;
    expect(Math.abs(distanceM(LAST, pin) - 300)).toBeLessThan(2);
    expect(Math.abs(bearingDeg(LAST, pin) - 60)).toBeLessThan(1);
  });
});
