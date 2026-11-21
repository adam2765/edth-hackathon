import { describe, expect, it } from "vitest";
import { clockSaid, facingSaid, klicksSaid, turnClock, withFacing } from "../lib/geo/clock";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { bearingDeg, distanceM } from "../lib/geo/geo";
import { resolve } from "../lib/geo/resolver";
import { affiliationSaid, kindSaid, resolveReport } from "../lib/geo/tracks";
import type { Intent, LastPosition } from "../lib/geo/types";

describe("which way the speaker faces [210]", () => {
  it("reads it in three languages", () => {
    expect(facingSaid("Facing north, contact 200 m at my 2 o'clock")).toBe(0);
    expect(facingSaid("I'm facing the east")).toBe(90);
    expect(facingSaid("Je suis face au nord-est")).toBe(45);
    expect(facingSaid("Face à l'ouest")).toBe(270);
    expect(facingSaid("Дивлюсь на північний схід")).toBe(45);
    expect(facingSaid("Facing the castle")).toBeNull();
    expect(facingSaid("Moved 300 metres north")).toBeNull();
  });

  it("turns a clock direction so that 12 is where the speaker faces", () => {
    const three = clockSaid("at my 3 o'clock")!;
    expect(turnClock(three, 0)).toMatchObject({ deg: 90, direction: "east" });
    expect(turnClock(three, 90)).toMatchObject({ deg: 180, direction: "south" });
    expect(turnClock(clockSaid("2 o'clock")!, 350)).toMatchObject({ deg: 50, direction: "north_east" });
  });

  it("moves the model's compass way with it, and leaves it alone with no facing said", () => {
    const i = intent({ kind: "movement", distance_m: 300, direction: "east" });
    expect(withFacing(i, "Facing south, moved 300 m to my 3 o'clock")).toMatchObject({ intent: { direction: "west" }, facing: 180 });
    expect(withFacing(i, "Facing west, moved 300 m to my 3 o'clock")).toMatchObject({ intent: { direction: "north" } });
    expect(withFacing(i, "Moved 300 m to my 3 o'clock")).toMatchObject({ intent: { direction: "east" }, facing: null });
    expect(withFacing(i, "Facing south, moved 300 m east").intent.direction).toBe("east"); // no clock said: nothing turns
  });

  it("reads klicks as kilometres", () => {
    expect(klicksSaid("Moving 2 klicks north")).toBe(2000);
    expect(klicksSaid("three klicks east")).toBe(3000);
    expect(klicksSaid("Moved 300 metres north")).toBeNull();
  });
});

const gaz = loadGazetteer();
const NOW = Date.parse("2026-11-21T09:00:00Z");
const CASTLE = { lat: 48.8427, lon: 2.4358 };
const last: LastPosition = { lat: CASTLE.lat, lon: CASTLE.lon, ts: NOW - 60_000, radius_m: 30 };
function intent(p: Partial<Intent>): Intent {
  return { kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: null, language: "en", confidence: 0.9, subject: "self", ...p };
}
const base = { now: NOW, gazetteer: gaz, lastPosition: last, areaCentre: { lat: 48.8455, lon: 2.435 } };

describe("a clock direction placed with the facing said [210]", () => {
  // As the extraction leaves it: `clockChecked` puts the clock's north-based compass way [198].
  const moved = intent({ kind: "movement", distance_m: 300, direction: "east" });

  it("goes on the facing said", () => {
    const r = resolve({ ...base, intent: moved, transcript: "Facing east, moved 300 metres to my 3 o'clock" });
    expect(r.status).toBe("resolved");
    expect(distanceM(last, r.pin!)).toBeCloseTo(300, -1);
    expect(bearingDeg(last, r.pin!)).toBeCloseTo(180, 0);
  });

  it("keeps 12 o'clock north with no facing, as before", () => {
    const r = resolve({ ...base, intent: intent({ kind: "movement", distance_m: 300, direction: "north_east" }), transcript: "Moved 300 metres to my 2 o'clock" });
    expect(bearingDeg(last, r.pin!)).toBeCloseTo(60, 0);
  });

  it("places a contact on the turned bearing, and names it that way", () => {
    const said = "Facing east. Contact, two enemy vehicles, 300 metres, my 3 o'clock";
    const r = resolveReport({ ...base, intent: intent({ subject: "track", track_kind: "vehicle", track_count: 2, distance_m: 300, direction: "east" }), transcript: said, observer: "ALPHA 1" });
    expect(r.status).toBe("resolved");
    expect(r.pin).toBeUndefined();
    const pin = r.track!.placement!.pin!;
    expect(bearingDeg(last, pin)).toBeCloseTo(180, 0);
    expect(r.track?.label).toBe("300 m south of ALPHA 1");
  });

  it("klicks win over what the model made of them", () => {
    const r = resolve({ ...base, intent: intent({ kind: "movement", distance_m: 2, direction: "north" }), transcript: "Moved 2 klicks north" });
    expect(distanceM(last, r.pin!)).toBeCloseTo(2000, -1);
  });
});

describe("field words [211]", () => {
  it("knows the names soldiers use for kit", () => {
    expect(kindSaid("Two BMPs moving north")).toBe("armour");
    expect(kindSaid("T-72 behind the church")).toBe("armour");
    expect(kindSaid("Mavic over the castle")).toBe("drone");
    expect(kindSaid("Shahed heading west")).toBe("drone");
    expect(kindSaid("Шахед летить на захід")).toBe("drone");
    expect(kindSaid("Grad firing from the forest")).toBe("artillery");
    expect(kindSaid("Sniper in the tower")).toBe("people");
    expect(kindSaid("Снайпер на даху")).toBe("people");
  });

  it("knows the words for the enemy and for friends", () => {
    expect(affiliationSaid("OPFOR at the bridge")).toBe("hostile");
    expect(affiliationSaid("Орки біля мосту")).toBe("hostile");
    expect(affiliationSaid("BLUFOR team at Bérault")).toBe("friendly");
  });
});
