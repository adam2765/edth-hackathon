import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { StyleSpecification } from "maplibre-gl";
import { AREAS } from "@/lib/geo/areas";
import { HOSTED_STYLE_URL, LOCAL_STYLE_PATH, NO_BASE_MAP_NOTE, isStyle, loadBaseMap, plainStyle, styleOrder, withOrigin } from "@/lib/map/baseMap";
import { LABEL_FONTS, LABEL_RANGES, fontStacks, glyphRanges, localStyle, marginAt, outsideAddresses, tileAt, tilePlan, tileStrings, tilesAt } from "@/lib/map/offline";
import { baseMapPreference } from "@/lib/map/prefer";

const ORIGIN = "https://192.168.1.20:3117";

/** The shape of OpenFreeMap's "liberty" style on 22 Nov 2026, cut down to what the code reads. */
const HOSTED: StyleSpecification = {
  version: 8,
  sources: {
    ne2_shaded: { type: "raster", maxzoom: 6, tileSize: 256, tiles: ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"] },
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
    { id: "road-name", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"] } },
    { id: "water-name", type: "symbol", source: "openmaptiles", "source-layer": "water_name", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"] } },
    { id: "place", type: "symbol", source: "openmaptiles", "source-layer": "place", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"] } },
  ],
};
const INDEX = {
  tiles: ["https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf"],
  minzoom: 0,
  maxzoom: 14,
  attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © OpenMapTiles Data from OpenStreetMap',
};
const LOCAL = localStyle(HOSTED, () => INDEX);

function reply(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

/** A fetch that answers by address; an address that is not listed fails like a dead network. */
function fetcher(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fn = async (url: string) => {
    asked.push(url);
    if (!(url in answers)) throw new TypeError("Failed to fetch");
    return reply(answers[url], answers[url] !== 404);
  };
  return { fn, asked };
}

describe("which base map the coordinator prefers", () => {
  const before = { ...process.env };
  afterEach(() => {
    process.env = { ...before };
  });
  it("follows the models: saved in offline mode, hosted otherwise", () => {
    delete process.env.BASEMAP;
    process.env.PROVIDER_MODE = "local";
    expect(baseMapPreference()).toBe("local");
    process.env.PROVIDER_MODE = "hosted";
    expect(baseMapPreference()).toBe("hosted");
    delete process.env.PROVIDER_MODE;
    expect(baseMapPreference()).toBe("hosted");
  });
  it("BASEMAP wins over the mode, either way", () => {
    process.env.PROVIDER_MODE = "hosted";
    process.env.BASEMAP = " Local ";
    expect(baseMapPreference()).toBe("local");
    process.env.PROVIDER_MODE = "local";
    process.env.BASEMAP = "hosted";
    expect(baseMapPreference()).toBe("hosted");
    process.env.BASEMAP = "something else";
    expect(baseMapPreference()).toBe("local");
  });
});

describe("the style the map starts with", () => {
  it("tries the preferred one first, then the other", () => {
    expect(styleOrder("local")).toEqual(["local", "hosted"]);
    expect(styleOrder("hosted")).toEqual(["hosted", "local"]);
  });

  it("offline mode uses the saved map and never asks OpenFreeMap", async () => {
    const f = fetcher({ "/api/basemap": { prefer: "local" }, [LOCAL_STYLE_PATH]: LOCAL.style, [HOSTED_STYLE_URL]: HOSTED });
    const base = await loadBaseMap(f.fn, ORIGIN);
    expect(base.source).toBe("local");
    expect(f.asked).toEqual(["/api/basemap", LOCAL_STYLE_PATH]);
    // Every address is on the coordinator, under the name the browser used.
    const s = base.style;
    expect(s.glyphs).toBe(`${ORIGIN}/basemap/fonts/{fontstack}/{range}.pbf`);
    expect(s.sprite).toBe(`${ORIGIN}/basemap/sprites/ofm`);
    expect((s.sources.openmaptiles as { tiles: string[] }).tiles).toEqual([`${ORIGIN}/basemap/tiles/{z}/{x}/{y}.pbf`]);
    expect((s.sources.ne2_shaded as { tiles: string[] }).tiles).toEqual([`${ORIGIN}/basemap/ne2_shaded/{z}/{x}/{y}.png`]);
    expect(base.attribution.join(" ")).toContain("OpenStreetMap");
  });

  it("hosted mode uses the hosted style even when a saved map is there", async () => {
    const f = fetcher({ "/api/basemap": { prefer: "hosted" }, [LOCAL_STYLE_PATH]: LOCAL.style, [HOSTED_STYLE_URL]: HOSTED });
    const base = await loadBaseMap(f.fn, ORIGIN);
    expect(base.source).toBe("hosted");
    expect(base.style).toEqual(HOSTED);
    expect(f.asked).toEqual(["/api/basemap", HOSTED_STYLE_URL]);
  });

  it("hosted mode with no network falls back to the saved map", async () => {
    const f = fetcher({ "/api/basemap": { prefer: "hosted" }, [LOCAL_STYLE_PATH]: LOCAL.style });
    expect((await loadBaseMap(f.fn, ORIGIN)).source).toBe("local");
  });

  it("offline mode with no saved map falls back to the hosted style when there is a network", async () => {
    const f = fetcher({ "/api/basemap": { prefer: "local" }, [LOCAL_STYLE_PATH]: 404, [HOSTED_STYLE_URL]: HOSTED });
    expect((await loadBaseMap(f.fn, ORIGIN)).source).toBe("hosted");
  });

  it("with neither, the map starts on a plain background that says so, with the label fonts from the coordinator", async () => {
    const f = fetcher({ "/api/basemap": { prefer: "local" }, [LOCAL_STYLE_PATH]: 404 });
    const base = await loadBaseMap(f.fn, ORIGIN);
    expect(base.source).toBe("none");
    expect(base.attribution).toContain(NO_BASE_MAP_NOTE);
    expect(NO_BASE_MAP_NOTE).toContain("Base map not available");
    expect(base.style.glyphs).toBe(`${ORIGIN}/glyphs/{fontstack}/{range}.pbf`);
    expect(base.style.sources).toEqual({});
    expect(outsideAddresses(base.style).every((u) => u.startsWith(ORIGIN))).toBe(true);
  });

  it("still starts when the coordinator's own answer is missing or is not a style", async () => {
    // No /api/basemap at all: hosted is assumed. A "not found" page in place of the saved style is not a style.
    const f = fetcher({ [LOCAL_STYLE_PATH]: { error: "not found" } });
    expect((await loadBaseMap(f.fn, ORIGIN)).source).toBe("none");
    expect(isStyle(plainStyle(ORIGIN))).toBe(true);
    expect(isStyle({ version: 8 })).toBe(false);
    expect(isStyle(null)).toBe(false);
  });

  it("completes only addresses that start at the coordinator's root", () => {
    const mixed = withOrigin({ ...LOCAL.style, glyphs: "https://elsewhere.example/{fontstack}/{range}.pbf" }, ORIGIN);
    expect(mixed.glyphs).toBe("https://elsewhere.example/{fontstack}/{range}.pbf");
    expect(mixed.sprite).toBe(`${ORIGIN}/basemap/sprites/ofm`);
    // The saved style itself is left as it was.
    expect(LOCAL.style.sprite).toBe("/basemap/sprites/ofm");
  });
});

describe("the saved style", () => {
  it("asks no other host: tiles, fonts and icons all come from the coordinator", () => {
    expect(outsideAddresses(HOSTED).length).toBe(4);
    expect(outsideAddresses(LOCAL.style)).toEqual([]);
  });

  it("holds the tile index, so the map needs no second request", () => {
    const v = LOCAL.style.sources.openmaptiles as { url?: string; tiles: string[]; minzoom: number; maxzoom: number; attribution: string; sparse: boolean };
    expect(v.url).toBeUndefined();
    expect(v.tiles).toEqual(["/basemap/tiles/{z}/{x}/{y}.pbf"]);
    expect([v.minzoom, v.maxzoom]).toEqual([0, 14]);
    // OpenFreeMap's and OpenStreetMap's attribution stays on the map.
    expect(v.attribution).toContain("OpenFreeMap");
    expect(v.attribution).toContain("OpenStreetMap");
    // A tile that was not saved is drawn from the saved one above it.
    expect(v.sparse).toBe(true);
  });

  it("says where each thing is fetched from", () => {
    expect(LOCAL.vectorTemplate).toBe(INDEX.tiles[0]);
    expect(LOCAL.rasters).toEqual([{ id: "ne2_shaded", template: "https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png", maxzoom: 6, ext: "png" }]);
    expect(LOCAL.sprite).toBe(HOSTED.sprite);
    expect(LOCAL.glyphs).toBe(HOSTED.glyphs);
  });

  it("stops on a source it does not know how to save", () => {
    const odd = { ...HOSTED, sources: { ...HOSTED.sources, extra: { type: "geojson", data: "https://example.org/x.geojson" } } } as StyleSpecification;
    expect(() => localStyle(odd, () => INDEX)).toThrow(/extra/);
  });

  it("finds every font the labels name", () => {
    expect(fontStacks(HOSTED)).toEqual(["Noto Sans Bold", "Noto Sans Italic", "Noto Sans Regular"]);
    const mixed = {
      ...HOSTED,
      layers: [
        { id: "a", type: "symbol", source: "s", layout: { "text-font": ["case", ["has", "x"], ["literal", ["A", "B"]], ["literal", ["C"]]] } },
        { id: "b", type: "symbol", source: "s", layout: { "text-field": ["format", ["get", "name"], { "text-font": ["literal", ["Noto Sans Bold"]] }], "text-font": ["Noto Sans Regular"] } },
        { id: "c", type: "symbol", source: "s", layout: { "text-font": { stops: [[6, ["D"]], [10, ["E"]]] } } },
      ],
    } as unknown as StyleSpecification;
    expect(fontStacks(mixed)).toEqual(["A,B", "C", "D", "E", "Noto Sans Bold", "Noto Sans Regular"]);
  });
});

describe("which tiles are saved for an area", () => {
  const v = AREAS.vincennes.bbox;

  it("numbers tiles the usual way", () => {
    expect(tileAt(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0 });
    expect(tileAt(48.8455, 2.435, 14)).toEqual({ z: 14, x: 8302, y: 5637 });
    expect(tileAt(48.8455, 2.435, 12)).toEqual({ z: 12, x: 2075, y: 1409 });
    // The poles and the date line stay inside the grid.
    expect(tileAt(89.9, 179.999, 3)).toEqual({ z: 3, x: 7, y: 0 });
    expect(tileAt(-89.9, -180, 3)).toEqual({ z: 3, x: 0, y: 7 });
  });

  it("covers the area's own tiles and a margin that is wider where the map is used", () => {
    expect([marginAt(14), marginAt(12), marginAt(11), marginAt(8), marginAt(7), marginAt(0)]).toEqual([2, 2, 1, 1, 0, 0]);
    const own = tilesAt(v, 14, 0);
    expect(own.length).toBe(9); // 3 across, 3 down
    expect(tilesAt(v, 14, 2).length).toBe(49);
    expect(tilesAt(v, 0, 2)).toEqual([{ z: 0, x: 0, y: 0 }]);
  });

  it("every corner of every area is in the plan at every zoom", () => {
    for (const area of Object.values(AREAS)) {
      const plan = new Set(tilePlan(area.bbox, 0, 14).map((t) => `${t.z}/${t.x}/${t.y}`));
      for (let z = 0; z <= 14; z++)
        for (const [lat, lon] of [[area.bbox.n, area.bbox.w], [area.bbox.s, area.bbox.e], [area.centre.lat, area.centre.lon]] as const) {
          const t = tileAt(lat, lon, z);
          expect(plan.has(`${t.z}/${t.x}/${t.y}`), `${area.id} ${z}`).toBe(true);
        }
    }
  });

  it("stays far inside OpenFreeMap's limit of 3,000 tiles for one download", () => {
    expect(tilePlan(v, 0, 14).length).toBe(154);
    for (const area of Object.values(AREAS)) expect(tilePlan(area.bbox, 0, 14).length).toBeLessThan(400);
  });
});

describe("which font files the labels need", () => {
  // A vector tile by hand: one layer (field 3) with a name (1), two text values (4 > 1) and a number value (4 > 3).
  const text = (s: string) => [...new TextEncoder().encode(s)];
  const field = (tag: number, body: number[]) => [tag * 8 + 2, body.length, ...body];
  const layer = [...field(1, text("place")), ...field(4, field(1, text("Château de Vincennes"))), ...field(4, field(1, text("Ізюм"))), ...field(4, [3 * 8 + 1, 0, 0, 0, 0, 0, 0, 0, 0]), 15 * 8, 2];
  const tile = new Uint8Array(field(3, layer));

  it("reads every text value out of a vector tile", () => {
    expect(tileStrings(tile)).toEqual(["Château de Vincennes", "Ізюм"]);
    expect(tileStrings(new Uint8Array())).toEqual([]);
  });

  it("names the blocks of 256 those letters fall in", () => {
    expect(glyphRanges(tileStrings(tile))).toEqual([0, 1024]);
    expect(glyphRanges(["≈ 14:32 · ALPHA 1", "Œuvre"])).toEqual([0, 256, 8704]);
  });

  it("leaves out what MapLibre draws with a font of the computer", () => {
    // Chinese, Japanese, Korean, Devanagari, Thai, and anything past the first 65,536 characters.
    expect(glyphRanges(["中国", "日本", "한국", "भारत", "ไทย", "😀"])).toEqual([]);
    // Arabic, Greek and Georgian come from the font files.
    expect(glyphRanges(["مصر", "Ελλάδα", "საქართველო"])).toEqual([768, 1536, 4096]);
  });

  it("the label fonts in git cover what the app's own labels are written in", () => {
    const needed = glyphRanges(["ALPHA 1 · silent", "≈ 14:32", "T1 · suspect vehicle ×2", "Start · Château de Vincennes", "БРАВО 2 · Ізюм", "№ 3 → “Œuvre” – ±40 m"]);
    for (const range of needed) expect(LABEL_RANGES, `range ${range}`).toContain(range);
    for (const font of LABEL_FONTS)
      for (const range of LABEL_RANGES) {
        const file = `public/glyphs/${font}/${range}-${range + 255}.pbf`;
        expect(existsSync(file), file).toBe(true);
        expect(readFileSync(file).length, file).toBeGreaterThan(1000);
      }
  });
});
