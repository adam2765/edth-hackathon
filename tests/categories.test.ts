import { describe, expect, it } from "vitest";
import { resolve } from "../lib/geo/resolver";
import { biasTerms, genericCategoryOf, loadGazetteer } from "../lib/geo/gazetteer";
import { distanceM, nearestPointOnLines } from "../lib/geo/geo";
import { AREAS, type AreaId } from "../lib/geo/areas";
import type { GazetteerFeature, Intent, LastPosition } from "../lib/geo/types";

const NOW = Date.parse("2026-11-20T16:00:00Z");

function intent(p: Partial<Intent>): Intent {
  return { kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: "at", language: "en", confidence: 0.9, ...p };
}
const at = (p: { lat: number; lon: number }, ageMin = 1): LastPosition => ({ lat: p.lat, lon: p.lon, ts: NOW - ageMin * 60_000 });

const point = (id: string, name: string, category: GazetteerFeature["category"], lat: number, lon: number): GazetteerFeature => ({
  id,
  name,
  names: [name],
  category,
  lat,
  lon,
  osm_type: "node",
  osm_id: 1,
});

describe("category words for stops, fuel, pharmacies, hotels, water and buildings", () => {
  it.each([
    ["the bus stop", "stop"],
    ["l'arrêt", "stop"],
    ["зупинці", "stop"],
    ["the petrol station", "fuel"],
    ["la station-service", "fuel"],
    ["АЗС", "fuel"],
    ["заправки", "fuel"],
    ["la pharmacie", "pharmacy"],
    ["аптеки", "pharmacy"],
    ["the hotel", "hotel"],
    ["готелю", "hotel"],
    ["the river", "water"],
    ["le lac", "water"],
    ["річки", "water"],
    ["the building", "building"],
    ["будівлі", "building"],
  ])("%s is a %s", (said, category) => {
    expect(genericCategoryOf(said)).toBe(category);
  });

  it("hôtel de ville is still the town hall, and stop is no longer a metro word", () => {
    expect(genericCategoryOf("l'hôtel de ville")).toBe("town_hall");
    expect(genericCategoryOf("la mairie")).toBe("town_hall");
    expect(genericCategoryOf("the stop")).toBe("stop");
    expect(genericCategoryOf("the metro station")).toBe("metro_station");
  });

  it("a headquarters is not a pond: ставка is not a water word", () => {
    expect(genericCategoryOf("ставки")).toBeUndefined();
  });
});

describe("a category said without a name", () => {
  // Two pharmacies 1.1 km apart.
  const WEST = point("node/1", "Pharmacie du Château", "pharmacy", 48.847, 2.43);
  const EAST = point("node/2", "Pharmacie de la Mairie", "pharmacy", 48.847, 2.445);
  const run = (lastPosition?: LastPosition) =>
    resolve({ intent: intent({ landmark_category: "pharmacy", language: "fr" }), transcript: "Je suis à la pharmacie", lastPosition, now: NOW, gazetteer: [WEST, EAST], areaCentre: { lat: 48.847, lon: 2.4375 } });

  it("next to one of them, the nearest wins", () => {
    const r = run(at({ lat: 48.8471, lon: 2.4302 }));
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(WEST.id);
  });

  it("with no last position, asks which one, in the speaker's language", () => {
    const r = run();
    expect(r.status).toBe("ambiguous");
    expect(r.question).toMatch(/^Quelle pharmacie : /);
  });
});

describe("a name made only of type words", () => {
  const HOTEL = point("node/10", "Hôtel du Château", "hotel", 48.8451, 2.435);
  const OTHER_HOTEL = point("node/11", "Hôtel Trianon", "hotel", 48.846, 2.437);
  const CASTLE = point("way/12", "Château de Vincennes", "castle", 48.8427, 2.4365);
  const PLAIN = point("node/13", "Pharmacie", "pharmacy", 48.8452, 2.4352);
  const OTHER_PHARMACY = point("node/14", "Pharmacie Centrale", "pharmacy", 48.8461, 2.4371);
  const gazetteer = [HOTEL, OTHER_HOTEL, CASTLE, PLAIN, OTHER_PHARMACY];
  const run = (p: Partial<Intent>, transcript: string) => resolve({ intent: intent(p), transcript, now: NOW, gazetteer, areaCentre: { lat: 48.8455, lon: 2.436 } });

  it("is a name when a place is called exactly that", () => {
    const r = run({ landmark_name: "Hôtel du Château", landmark_category: "hotel" }, "I'm at the Hôtel du Château");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(HOTEL.id);
  });

  it("is still generic when it is one word, even if a place has that name", () => {
    const r = run({ landmark_name: "pharmacie", landmark_category: "pharmacy", language: "fr" }, "Je suis à la pharmacie");
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((c) => c.id).sort()).toEqual([PLAIN.id, OTHER_PHARMACY.id].sort());
  });
});

describe("a river is a line", () => {
  // A river running west to east, 3 km long.
  const RIVER: GazetteerFeature = {
    id: "water/marne",
    name: "Marne",
    names: ["Marne"],
    category: "water",
    subtype: "river",
    lat: 48.82,
    lon: 2.45,
    bbox: [2.43, 48.82, 2.47, 48.82],
    osm_type: "way",
    osm_id: 1,
    lines: [
      [
        [2.43, 48.82],
        [2.47, 48.82],
      ],
    ],
  };

  it("places the speaker on the stretch nearest them, not at the river's middle", () => {
    const last = at({ lat: 48.8205, lon: 2.432 });
    const r = resolve({ intent: intent({ landmark_name: "Marne", landmark_category: "water", relation: "near" }), transcript: "I'm near the Marne", lastPosition: last, now: NOW, gazetteer: [RIVER] });
    expect(r.status).toBe("resolved");
    expect(distanceM(r.pin!, nearestPointOnLines(last, RIVER.lines!))).toBeLessThan(1);
    expect(r.radius_m).toBeLessThanOrEqual(100);
  });
});

describe.each(["vincennes", "kyiv"] as AreaId[])("the %s gazetteer", (area) => {
  const gaz = loadGazetteer(area);
  const box = AREAS[area].bbox;

  it("has every new kind of place", () => {
    const cats = new Set(gaz.map((f) => f.category));
    for (const c of ["stop", "pharmacy", "hotel", "water", "building"] as const) expect(cats.has(c)).toBe(true);
  });

  it("puts every place within about 1 km of the area", () => {
    const far = gaz.filter((f) => f.lat < box.s - 0.01 || f.lat > box.n + 0.01 || f.lon < box.w - 0.015 || f.lon > box.e + 0.015);
    expect(far.map((f) => `${f.id} ${f.name}`)).toEqual([]);
  });

  it("has no stop named after a place within 400 m: that would only add a question", () => {
    const stops = gaz.filter((f) => f.category === "stop");
    const echo = stops.filter((s) =>
      gaz.some((f) => f.category !== "stop" && f.category !== "building" && f.name.toLowerCase() === s.name.toLowerCase() && distanceM(s, f.lines?.length ? nearestPointOnLines(s, f.lines) : f) <= 400),
    );
    expect(echo.map((s) => s.name)).toEqual([]);
  });

  it("keeps pharmacies, fuel and buildings out of the speech-to-text hints", () => {
    const hints = new Set(biasTerms(gaz));
    const leaked = gaz.filter((f) => (f.category === "pharmacy" || f.category === "fuel" || f.category === "building") && hints.has(f.name) && !gaz.some((o) => o.name === f.name && o.category !== f.category));
    expect(leaked.map((f) => f.name)).toEqual([]);
  });
});
