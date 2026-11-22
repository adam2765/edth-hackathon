import { describe, expect, it } from "vitest";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { distanceM } from "../lib/geo/geo";
import { readGrid, shortGrid, toGrid, toUtm, typedGrid } from "../lib/geo/grid";
import { resolve } from "../lib/geo/resolver";
import { resolveReport } from "../lib/geo/tracks";
import { positionFromReport } from "../lib/reports/position";
import type { Intent } from "../lib/geo/types";

const VINCENNES = { lat: 48.8455, lon: 2.435 };
const KYIV = { lat: 50.4501, lon: 30.5234 };
const IZIUM = { lat: 49.1912, lon: 37.2786 };
// Checked against the `mgrs` library (proj4js's MGRS, in Python): the castle, Maidan, Izium's square.
const CASTLE = { lat: 48.8427, lon: 2.4358 }; // 31U DQ 58603 10123

describe("a grid reference said out loud [223]", () => {
  it("reads the full grid, to a metre", () => {
    const g = readGrid("Grid 31U DQ 58603 10123", VINCENNES)!;
    expect(g.text).toBe("31U DQ 58603 10123");
    expect(distanceM(g.pin, CASTLE)).toBeLessThan(2);
    expect(g.radius_m).toBe(5);
    expect(distanceM(readGrid("Квадрат UA 24182 91607", KYIV)!.pin, { lat: 50.450099, lon: 30.523404 })).toBeLessThan(2);
    expect(distanceM(readGrid("37U CQ 74577 50137", IZIUM)!.pin, { lat: 49.191203, lon: 37.278595 })).toBeLessThan(2);
  });

  it("reads it spelled, run together, or with the zone and square left out", () => {
    const six = readGrid("I'm at grid DQ 586 101", VINCENNES)!;
    expect(six.text).toBe("DQ 586 101");
    expect(six.radius_m).toBe(71); // a 100 m cell
    expect(distanceM(six.pin, CASTLE)).toBeLessThan(100);
    for (const said of ["Delta Quebec 586 101", "grille 586 101", "31UDQ586101", "grid dq 586 101", "grid at DQ 586 101 by the hotel"]) {
      expect(readGrid(said, VINCENNES)?.pin, said).toEqual(six.pin);
    }
    expect(readGrid("сітка 745 501", IZIUM)?.text).toBe("CQ 745 501");
  });

  it("reads digits said one by one, as on a radio", () => {
    for (const said of ["Grid Delta Quebec five eight six one zero one", "grid five eight six one oh one", "grid DQ five eight six, one zero one, over", "grille cinq huit six un zéro un", "Track 2, grid DQ 586 101"]) {
      expect(readGrid(said, VINCENNES)?.text, said).toBe("DQ 586 101");
    }
    expect(readGrid("Квадрат UA два чотири один дев'ять один шість", KYIV)?.text).toBe("UA 241 916");
  });

  it("reads a French or Ukrainian transcript's spelling [226]", () => {
    expect(readGrid("Grille Delta Québec cinq huit six un zéro un", VINCENNES)?.text).toBe("DQ 586 101");
    expect(readGrid("Квадрат Юніформ Альфа два чотири один дев'ять один шість", KYIV)?.text).toBe("UA 241 916");
    expect(readGrid("Квадрат юніформ альфа 241 916", KYIV)?.text).toBe("UA 241 916");
    for (const said of ["Я біля готелю", "Готель Україна, 5 поверх"]) expect(readGrid(said, KYIV), said).toBeNull();
  });

  it("leaves distances, counts and names alone", () => {
    for (const said of ["two vehicles at three o'clock", "I see one two three", "I'm 200 metres north of the church", "Track 2, two vehicles at 300 metres", "Maidan Palace Hotel", "I'm at the château de Vincennes", "586 101"]) {
      expect(readGrid(said, VINCENNES), said).toBeNull();
    }
  });

  it("gives the grid of a point, as the mgrs library does [231]", () => {
    expect(toGrid(CASTLE)).toBe("31U DQ 5860 1012");
    expect(toGrid(CASTLE, 10)).toBe("31U DQ 58603 10123");
    expect(toGrid({ lat: 50.4501, lon: 30.5234 })).toBe("36U UA 2418 9160");
    expect(toGrid({ lat: 49.1912, lon: 37.2786 }, 6)).toBe("37U CQ 745 501");
    // Read back, a grid lands within its own cell.
    expect(distanceM(readGrid(`grid ${toGrid(CASTLE)}`, VINCENNES)!.pin, CASTLE)).toBeLessThan(10);
  });

  it("agrees with the reference UTM for the area's centre", () => {
    const u = toUtm(VINCENNES);
    expect(u.zone).toBe(31);
    expect(u.easting).toBeCloseTo(458546.9, 0);
    expect(u.northing).toBeCloseTo(5410434.9, 0);
  });
});

const gaz = loadGazetteer();
const NOW = Date.parse("2026-11-21T09:00:00Z");
const intent = (p: Partial<Intent>): Intent => ({ kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: null, language: "en", confidence: 0.9, subject: "self", ...p });

describe("a grid in a report [223]", () => {
  it("places the speaker at the cell, with no place to look up", () => {
    const r = resolve({ intent: intent({ landmark_name: "DQ 586 101" }), transcript: "I'm at grid DQ 586 101", now: NOW, gazetteer: gaz, areaCentre: VINCENNES });
    expect(r).toMatchObject({ status: "resolved", radius_m: 71, evidence: { rule: "grid_reference" } });
    expect(distanceM(r.pin!, CASTLE)).toBeLessThan(100);
  });

  it("shows the grid on the command post, not \"position\" [228]", () => {
    const r = resolve({ intent: intent({}), transcript: "Alpha 1, grid DQ 586 101", now: NOW, gazetteer: gaz, areaCentre: VINCENNES });
    expect(positionFromReport(r, null)?.label).toBe("grid DQ 586 101");
  });

  it("places a thing off a grid by the distance and way said [230]", () => {
    const self = resolve({ intent: intent({ distance_m: 200, direction: "north" }), transcript: "I'm at grid DQ 586 101, 200 metres north", now: NOW, gazetteer: gaz, areaCentre: VINCENNES });
    const cell = readGrid("grid DQ 586 101", VINCENNES)!.pin;
    expect(distanceM(cell, self.pin!)).toBeCloseTo(200, -1);
    expect(self).toMatchObject({ evidence: { rule: "grid_reference" }, estimated: true });
    expect(positionFromReport(self, null)?.label).toBe("200 m north of grid DQ 586 101");
    const drone = resolveReport({ intent: intent({ subject: "track", track_kind: "drone", distance_m: 200, relation: "north_of", landmark_name: "grid DQ 586 101" }), transcript: "Enemy drone 200 metres north of grid DQ 586 101", now: NOW, gazetteer: gaz, areaCentre: VINCENNES, observer: "ALPHA 1" });
    expect(drone.track?.label).toBe("200 m north of grid DQ 586 101");
    expect(distanceM(cell, drone.track!.placement!.pin!)).toBeCloseTo(200, -1);
  });

  it("asks again for a grid far outside the area", () => {
    const r = resolve({ intent: intent({}), transcript: "grid 31U DQ 100 900", now: NOW, gazetteer: gaz, areaCentre: VINCENNES });
    expect(r).toMatchObject({ status: "unresolved", evidence: { rule: "grid_too_far" } });
    expect(r.question).toMatch(/^Grid 31U DQ 100 900 is \d+ km away/);
  });

  it("places a track at the grid, and leaves the speaker where they are", () => {
    const said = "Two enemy vehicles at grid DQ 586 101";
    const r = resolveReport({ intent: intent({ subject: "track", track_kind: "vehicle", track_count: 2 }), transcript: said, now: NOW, gazetteer: gaz, areaCentre: VINCENNES, observer: "ALPHA 1" });
    expect(r.status).toBe("resolved");
    expect(r.pin).toBeUndefined();
    expect(r.track?.label).toBe("grid DQ 586 101");
    expect(distanceM(r.track!.placement!.pin!, CASTLE)).toBeLessThan(100);
  });
});

describe("a grid on the command post [245]", () => {
  it("writes a point's grid as it is said: the square and six figures", () => {
    expect(shortGrid(CASTLE)).toBe("DQ 586 101");
    expect(shortGrid({ lat: 50.450099, lon: 30.523404 })).toBe("UA 241 916");
  });

  it("reads a grid typed into the place search, with or without its square and zone", () => {
    for (const typed of ["586 101", "586101", "DQ 586 101", "dq 586 101", "31U DQ 586 101", "31UDQ586101"]) {
      const g = typedGrid(typed, VINCENNES)!;
      expect(g, typed).not.toBeNull();
      expect(shortGrid(g.pin), typed).toBe("DQ 586 101");
      expect(g.radius_m, typed).toBe(71);
    }
    expect(typedGrid(" DQ 5860 1012 ", VINCENNES)).toMatchObject({ text: "DQ 5860 1012", radius_m: 7 });
  });

  it("leaves a place's name alone, and a grid too wide to place anything in", () => {
    for (const typed of ["", "12 rue de Paris", "Bérault", "château 2", "58 10", "586 10", "DQ", "586 101 north"]) expect(typedGrid(typed, VINCENNES), typed).toBeNull();
  });
});
