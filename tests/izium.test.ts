import { describe, expect, it } from "vitest";
import { resolve } from "../lib/geo/resolver";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { AREAS } from "../lib/geo/areas";
import { distanceM } from "../lib/geo/geo";
import type { Intent, LastPosition } from "../lib/geo/types";

// The Izium demo script (scenarios/izium-demo.json) against the built file. The intents are the
// ones hosted Mistral returned for the script's sentences on 21 November.
const gaz = loadGazetteer("izium");
const NOW = Date.parse("2026-11-21T09:00:00Z");
const centre = AREAS.izium.centre;
const byId = (id: string) => gaz.find((f) => f.id === id)!;

const STATION = byId("node/610644672");
const BUS_STATION = byId("way/303537609");
const ASCENSION = byId("way/418080265");
const TRANSFIGURATION = byId("way/303690440");
const HOLY_CROSS = byId("way/303604833");
const SQUARE = byId("way/1456976965");
const HOSPITAL = byId("way/303604941");
const YEVROPEISKA = byId("street/європейська-вулиця");
const DONETS = byId("water/сіверський-донець");

function intent(p: Partial<Intent>): Intent {
  return { kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: "at", language: "uk", confidence: 0.9, ...p };
}
const at = (f: { lat: number; lon: number }, radius_m = 30): LastPosition => ({ lat: f.lat, lon: f.lon, ts: NOW - 60_000, radius_m });
const run = (i: Intent, transcript: string, lastPosition?: LastPosition) => resolve({ intent: i, transcript, lastPosition, now: NOW, gazetteer: gaz, areaCentre: centre });

describe("the Izium gazetteer", () => {
  it("has the places the demo script names", () => {
    expect(STATION).toMatchObject({ name: "Ізюм", category: "metro_station" });
    expect(ASCENSION).toMatchObject({ name: "Свято-Вознесенський кафедральний собор", category: "church" });
    expect(TRANSFIGURATION).toMatchObject({ name: "Спасо-Преображенський собор", category: "church" });
    expect(HOLY_CROSS).toMatchObject({ name: "Хрестовоздвиженська церква", category: "church" });
    expect(SQUARE).toMatchObject({ name: "Центральна площа" });
    expect(HOSPITAL).toMatchObject({ name: "Центральна районна лікарня", category: "hospital" });
    expect(YEVROPEISKA.lines?.length).toBeGreaterThan(0);
    expect(DONETS).toMatchObject({ name: "Сіверський Донець", category: "water" });
    expect(DONETS.lines?.length).toBeGreaterThan(0);
  });

  it("keeps the bus station with the stops: the railway station is the only station", () => {
    expect(BUS_STATION).toMatchObject({ name: "Ізюм", category: "stop", subtype: "bus_station" });
    expect(gaz.filter((f) => f.category === "metro_station").map((f) => f.id)).toEqual([STATION.id]);
  });

  it("holds no military office", () => {
    const military = /в[iі]йськкомат|во[еє]нкомат|ТЦК|комплектування/i;
    expect(gaz.filter((f) => f.category !== "street" && [f.name, ...f.names].some((n) => military.test(n)))).toEqual([]);
  });

  it("has every place inside the area's box or within 1 km of it", () => {
    const b = AREAS.izium.bbox;
    for (const f of gaz.filter((x) => !x.lines)) {
      expect(f.lat).toBeGreaterThan(b.s - 0.01);
      expect(f.lat).toBeLessThan(b.n + 0.01);
      expect(f.lon).toBeGreaterThan(b.w - 0.015);
      expect(f.lon).toBeLessThan(b.e + 0.015);
    }
  });
});

describe("the Izium demo script", () => {
  it("i1: “I'm at Izium station” is the railway station, not the bus station of the same name", () => {
    const r = run(intent({ landmark_name: "Izium station", landmark_name_lemma: "Izium station", landmark_category: "stop", language: "en" }), "I'm at Izium station.");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(STATION.id);
  });

  it("«на станції Ізюм» is the railway station too", () => {
    const r = run(intent({ landmark_name: "Ізюм", landmark_name_lemma: "Ізюм", landmark_category: "metro_station" }), "Я на станції Ізюм.");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(STATION.id);
  });

  it("i2: moving towards a street gives an arrow to it and an estimate", () => {
    const r = run(
      intent({ kind: "movement", landmark_name: "Європейської вулиці", landmark_name_lemma: "Європейська вулиця", landmark_category: "street", relation: "towards" }),
      "Рухаюсь до Європейської вулиці.",
      at(STATION),
    );
    expect(r.status).toBe("resolved");
    expect(r.heading_to?.id).toBe(YEVROPEISKA.id);
    expect(r.estimated).toBe(true);
  });

  it("i3: south of the cathedral, with the short name people say", () => {
    const r = run(
      intent({ landmark_name: "Свято-Вознесенського собору", landmark_name_lemma: "Свято-Вознесенський собор", landmark_category: "church", relation: "south_of" }),
      "Я на південь від Свято-Вознесенського собору.",
    );
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(ASCENSION.id);
    expect(r.pin!.lat).toBeLessThan(ASCENSION.lat);
    expect(distanceM(r.pin!, ASCENSION)).toBeGreaterThan(80);
    expect(distanceM(r.pin!, ASCENSION)).toBeLessThan(300);
  });

  it("i4: 500 metres east is worked out from the last position", () => {
    const last = at({ lat: 49.2174, lon: 37.26864 }, 100);
    const r = run(intent({ kind: "movement", relation: null, distance_m: 500, direction: "east" }), "Пройшов п'ятсот метрів на схід.", last);
    expect(r.status).toBe("resolved");
    expect(r.estimated).toBe(true);
    expect(r.evidence.rule).toBe("dead_reckoned");
    expect(distanceM(r.pin!, last)).toBeGreaterThan(450);
    expect(distanceM(r.pin!, last)).toBeLessThan(550);
    expect(r.pin!.lon).toBeGreaterThan(last.lon);
  });

  it("i5: the river by name, in the genitive, is the Siverskyi Donets", () => {
    const r = run(
      intent({ kind: "movement", landmark_name: "Сіверського Дінця", landmark_name_lemma: "Сіверський Донець", landmark_category: "water", relation: "towards" }),
      "Рухаюсь до Сіверського Дінця.",
      { lat: 49.2174, lon: 37.27552, ts: NOW - 60_000, radius_m: 300, uncertainty_m: 300 },
    );
    expect(r.status).toBe("resolved");
    expect(r.heading_to?.id).toBe(DONETS.id);
  });

  it("«до річки» from the same spot asks: three waterways are near", () => {
    const r = run(intent({ kind: "movement", landmark_name: "річки", landmark_name_lemma: "річка", landmark_category: "water", relation: "towards" }), "Рухаюсь до річки.", {
      lat: 49.2174,
      lon: 37.27552,
      ts: NOW - 60_000,
      radius_m: 300,
      uncertainty_m: 300,
    });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((c) => c.id)).toContain(DONETS.id);
    expect(r.question).toMatch(/Яка водойма/);
  });

  it("i6: the central square", () => {
    const r = run(intent({ landmark_name: "Центральній площі", landmark_name_lemma: "Центральна площа", landmark_category: "intersection" }), "Я на Центральній площі.");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(SQUARE.id);
  });

  it("i7: «біля церкви» on the central square asks which of the two churches", () => {
    const r = run(intent({ landmark_category: "church", relation: "near" }), "Я біля церкви.", at(SQUARE, 82));
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((c) => c.id)).toEqual([TRANSFIGURATION.id, HOLY_CROSS.id]);
    expect(r.question).toBe("Яка церква: Спасо-Преображенський собор чи Хрестовоздвиженська церква?");
  });

  it("i8: the next intersection going west from the cathedral is by the hospital", () => {
    const r = run(intent({ landmark_category: "intersection", direction: "west", language: "en" }), "Passing the next intersection, heading west.", at(TRANSFIGURATION, 80));
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("crossing_next_ahead");
    expect(r.evidence.feature_id).toBe("crossing/49.19046,37.27422");
    expect(distanceM(r.pin!, HOSPITAL)).toBeLessThan(250);
  });

  it("i9: the district hospital by its full name, not one of the nine clinics around it", () => {
    const r = run(
      intent({ landmark_name: "Центральної районної лікарні", landmark_name_lemma: "Центральна районна лікарня", landmark_category: "hospital", relation: "near" }),
      "Я біля Центральної районної лікарні.",
      at({ lat: 49.19046, lon: 37.27422 }),
    );
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(HOSPITAL.id);
  });
});

describe("ambiguity Izium offers", () => {
  it("«на Шевченка» asks which street: the town has a street and a lane of that name", () => {
    const r = run(intent({ landmark_name: "Шевченка", landmark_name_lemma: "Шевченка", landmark_category: "street" }), "Я на Шевченка.");
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["street/шевченка-вулиця", "street/шевченка-провулок"].sort());
    expect(r.question).toMatch(/^Яка вулиця/);
  });

  it("«біля мосту» is not placed: the town's bridges have no name in OpenStreetMap, so none is in the file", () => {
    expect(gaz.filter((f) => f.category === "bridge")).toEqual([]);
    const r = run(intent({ landmark_category: "bridge", relation: "near" }), "Я біля мосту.", at(SQUARE, 82));
    expect(r.status).toBe("unresolved");
    expect(r.pin).toBeUndefined();
  });
});
