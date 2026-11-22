import { describe, expect, it } from "vitest";
import { bearingSaid, withFacing } from "../lib/geo/clock";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { bearingDeg, distanceM } from "../lib/geo/geo";
import { resolveReport, sayBack } from "../lib/geo/tracks";
import type { LastPosition } from "../lib/geo/types";
import { sanitizeIntent } from "../lib/providers/extractor";

const gaz = loadGazetteer("vincennes");
const NOW = Date.parse("2026-11-21T19:30:00Z");
const LAST: LastPosition = { lat: 48.8427, lon: 2.4358, ts: NOW - 60_000, radius_m: 30 };
const deg = (text: string) => bearingSaid(text)?.deg ?? null;
const run = (raw: Record<string, unknown>, transcript: string) =>
  resolveReport({ intent: sanitizeIntent(raw, null, transcript), transcript, lastPosition: LAST, now: NOW, gazetteer: gaz, observer: "ALPHA 1" });

describe("a bearing said, in degrees or mils [229]", () => {
  it("reads it in three languages, in digits or digit by digit", () => {
    expect(deg("Contact, bearing 060, 300 metres")).toBe(60);
    expect(deg("bearing zero six zero, three hundred metres")).toBe(60);
    expect(deg("Ennemi azimut 120, 200 mètres")).toBe(120);
    expect(deg("Азимут 45, 300 метрів")).toBe(45);
    expect(deg("bearing 270 degrees")).toBe(270);
    expect(deg("contact at 060 degrees, 300 m")).toBe(60);
  });

  it("reads NATO mils, 6400 to the circle", () => {
    expect(deg("Two vehicles at 1600 mils, 500 metres")).toBe(90);
    expect(deg("bearing one six zero zero mils")).toBe(90);
  });

  it("leaves other numbers alone", () => {
    for (const said of ["bearing zero sixty", "bearing in mind the church", "I'm at 60 rue de Paris", "Track 2 heading 090", "200 metres north", "bearing 400", "at 3 o'clock"]) {
      expect(bearingSaid(said), said).toBeNull();
    }
  });

  it("is from north: a facing said does not turn it", () => {
    expect(withFacing(sanitizeIntent({ kind: "movement", direction: "north_east", distance_m: 300, language: "en" }), "Facing south, bearing 060, 300 m").clock?.deg).toBe(60);
  });
});

describe("a report with a bearing [229]", () => {
  it("places a contact on the bearing itself, not the nearest compass point", () => {
    // The model reads only the eight compass words: "bearing 060" comes back as north-east, 45°.
    const r = run({ kind: "position", subject: "track", track_kind: "vehicle", track_count: 2, distance_m: 300, direction: "north_east", language: "en" }, "Contact, two enemy vehicles, bearing 060, 300 metres");
    expect(r.status).toBe("resolved");
    const pin = r.track!.placement!.pin!;
    expect(distanceM(LAST, pin)).toBeCloseTo(300, -1);
    expect(bearingDeg(LAST, pin)).toBeCloseTo(60, 0);
  });

  it("sets the way when the model gave another one", () => {
    const r = run({ kind: "movement", distance_m: 200, direction: "north", language: "en" }, "Moved 200 metres, bearing 120");
    expect(bearingDeg(LAST, r.pin!)).toBeCloseTo(120, 0);
  });
});

describe("the way said back as it was said [230]", () => {
  const said = (raw: Record<string, unknown>, transcript: string) => sayBack(run(raw, transcript), sanitizeIntent(raw, null, transcript), transcript);

  it("repeats a bearing, not the nearest compass word", () => {
    const t = "Contact, two enemy vehicles, bearing 060, 300 metres";
    const raw = { kind: "position", track: { kind: "vehicle", count: 2 }, distance_m: 300, direction: "north_east", language: "en" };
    expect(said(raw, t)).toBe("Hostile vehicle, count 2, 300 metres, bearing 060. Not numbered: no mission.");
    expect(run(raw, t).track?.label).toBe("300 m, bearing 060, from ALPHA 1");
    expect(said({ ...raw, track: { kind: "armour" }, language: "uk" }, "Ворожий танк, азимут 75, 300 метрів")).toContain("300 метрів, азимут 075");
  });

  it("repeats a clock in the speaker's words, and keeps the compass way on the map", () => {
    const t = "Véhicule ennemi à 2 heures, 300 mètres";
    const raw = { kind: "position", track: { kind: "vehicle" }, distance_m: 300, direction: "north_east", language: "fr" };
    expect(said(raw, t)).toContain("300 mètres, à 2 heures");
    expect(run(raw, t).track?.label).toBe("300 m north-east of ALPHA 1");
  });
});
