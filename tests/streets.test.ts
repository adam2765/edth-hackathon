import { describe, expect, it } from "vitest";
import { groupStreetPieces, joinSameTown, lineGapM } from "../lib/geo/streets";

type Line = [number, number][];
// About 73 m per 0.001° of longitude and 111 m per 0.001° of latitude at 48.85° N.
const east = (lon0: number, lon1: number, lat = 48.85): Line => [
  [lon0, lat],
  [lon1, lat],
];

describe("same-name street pieces", () => {
  it("measures the gap between two pieces", () => {
    expect(lineGapM(east(2.43, 2.432), east(2.432, 2.434))).toBeLessThan(1);
    expect(lineGapM(east(2.43, 2.432), east(2.434, 2.436))).toBeCloseTo(146, -1);
    // A piece that runs alongside: the gap is measured to the segment, not only between vertices.
    expect(lineGapM(east(2.43, 2.44), east(2.434, 2.436, 48.8505))).toBeCloseTo(56, -1);
  });

  it("pieces that touch or nearly touch are one street; pieces 2 km apart are two", () => {
    const lines = [east(2.43, 2.432), east(2.432, 2.434), east(2.435, 2.437), east(2.46, 2.462)];
    expect(groupStreetPieces(lines)).toEqual([[0, 1, 2], [3]]);
  });

  it("in one town, pieces up to 1 km apart are joined; across towns they are not", () => {
    const a = { lines: [east(2.43, 2.432)], town: "Vincennes" };
    const b = { lines: [east(2.438, 2.44)], town: "Vincennes" }; // about 440 m from a
    const c = { lines: [east(2.448, 2.45)], town: "Fontenay-sous-Bois" }; // 730 m from b
    const d = { lines: [east(2.46, 2.462)], town: "Vincennes" }; // 2 km from b
    expect(joinSameTown([a, b, c, d])).toEqual([[0, 1], [2], [3]]);
  });

  it("groups with no town are never joined on the town rule", () => {
    const a = { lines: [east(2.43, 2.432)] };
    const b = { lines: [east(2.438, 2.44)] };
    expect(joinSameTown([a, b])).toEqual([[0], [1]]);
  });
});
