import { describe, expect, it } from "vitest";
import { placedFromObserver, sectorRing } from "../lib/geo/cone";
import { bearingDeg, destination, distanceM } from "../lib/geo/geo";
import { gridLines, gridSpacing, measureText, toUtm } from "../lib/geo/grid";

const VINCENNES = { lat: 48.8455, lon: 2.435 };
const CASTLE = { lat: 48.8427, lon: 2.4358 }; // 31U DQ 5860 1012

describe("the grid's lines [232]", () => {
  const box = { west: 2.405, south: 48.832, east: 2.465, north: 48.856 };
  const fc = gridLines(box, VINCENNES, 1000);
  const lines = fc.features.filter((f) => f.properties?.kind === "line");
  const labels = fc.features.filter((f) => f.properties?.kind === "label").map((f) => f.properties?.text);

  it("draws one line a kilometre each way, labelled as on a printed map", () => {
    expect(lines.length).toBeGreaterThan(6);
    expect(labels).toEqual(expect.arrayContaining(["57", "58", "59", "60", "10", "11"]));
  });

  it("puts the castle between lines 58 and 59, and 10 and 11", () => {
    const u = toUtm(CASTLE);
    expect(Math.floor((u.easting % 100000) / 1000)).toBe(58);
    expect(Math.floor((u.northing % 100000) / 1000)).toBe(10);
  });

  it("spaces the lines by zoom, and draws none when too many", () => {
    expect(gridSpacing(14)).toBe(1000);
    expect(gridSpacing(10)).toBe(10000);
    expect(gridSpacing(6)).toBeNull();
    expect(gridLines({ west: 1, south: 47, east: 4, north: 50 }, VINCENNES, 1000).features).toHaveLength(0);
  });
});

describe("the ruler [232]", () => {
  it("gives distance, bearing and mils", () => {
    const b = destination(CASTLE, 60, 300);
    expect(measureText(CASTLE, b)).toBe("300 m · bearing 060° · 1067 mils");
    expect(measureText(CASTLE, destination(CASTLE, 270, 1500))).toBe("1.50 km · bearing 270° · 4800 mils");
  });
});

describe("a cone for a thing placed from its observer [233]", () => {
  it("knows such a place by its label", () => {
    expect(placedFromObserver("300 m north-east of ALPHA 1")).toBe(true);
    expect(placedFromObserver("300 m, bearing 060, from ALPHA 1")).toBe(true);
    expect(placedFromObserver("200 m north of grid DQ 586 101")).toBe(false);
    expect(placedFromObserver("Mairie de Vincennes")).toBe(false);
  });

  it("runs along the line of sight, as deep and as wide as the circle", () => {
    const to = destination(CASTLE, 60, 300);
    const ring = sectorRing(CASTLE, to, 100)!.map(([lon, lat]) => ({ lat, lon }));
    const ds = ring.map((p) => distanceM(CASTLE, p));
    expect(Math.min(...ds)).toBeCloseTo(200, -1);
    expect(Math.max(...ds)).toBeCloseTo(400, -1);
    const bs = ring.map((p) => bearingDeg(CASTLE, p));
    expect(Math.min(...bs)).toBeCloseTo(60 - 19.5, 0);
    expect(Math.max(...bs)).toBeCloseTo(60 + 19.5, 0);
  });

  it("is no cone when the observer is inside the circle", () => {
    expect(sectorRing(CASTLE, destination(CASTLE, 60, 50), 100)).toBeNull();
  });
});
