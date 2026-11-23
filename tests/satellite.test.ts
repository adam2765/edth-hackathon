import { describe, expect, it } from "vitest";
import type { Map as MLMap } from "maplibre-gl";
import { BASEMAP_PATH } from "@/lib/map/offline";
import {
  addSatelliteLayers,
  layerCovers,
  SATELLITE_BELOW,
  SATELLITE_LAYERS,
  SATELLITE_PATH,
  savedTileTemplate,
  setSatelliteVisible,
} from "@/lib/map/satellite";

/** The smallest map the two functions read: sources, layers in drawing order, and their layout. */
function fakeMap() {
  const order = ["background", "start-fill", "pos"];
  const sources = new Map<string, unknown>();
  const layers = new Map<string, { id: string; source: string; layout?: Record<string, unknown> }>();
  const map = {
    order,
    sources,
    layers,
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => (order.includes(id) ? { id } : undefined),
    addSource: (id: string, source: unknown) => {
      sources.set(id, source);
    },
    addLayer: (layer: { id: string; source: string; layout?: Record<string, unknown> }, before?: string) => {
      const at = before && order.includes(before) ? order.indexOf(before) : order.length;
      order.splice(at, 0, layer.id);
      layers.set(layer.id, layer);
    },
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.layout = { ...(layer.layout ?? {}), [key]: value };
    },
  };
  return map as unknown as MLMap & typeof map;
}

const IGN = SATELLITE_LAYERS.find((l) => l.id === "satellite-ign")!;
const SENTINEL = SATELLITE_LAYERS.find((l) => l.id === "satellite-sentinel")!;

describe("photo view", () => {
  it("puts IGN over Sentinel, so a French tile wins and the rest of the world still shows", () => {
    expect(SATELLITE_LAYERS.map((l) => l.id)).toEqual(["satellite-sentinel", "satellite-ign"]);
    expect(IGN.maxzoom).toBeGreaterThan(SENTINEL.maxzoom);
    expect(IGN.tiles[0]).toContain("TILEMATRIX={z}");
    expect(IGN.tiles[0]).toContain("TILEROW={y}");
    expect(IGN.tiles[0]).toContain("TILECOL={x}");
    // EOX's WMTS path is zoom, row then column: y before x.
    expect(SENTINEL.tiles[0]).toContain("{z}/{y}/{x}.jpg");
  });

  it("saves no deeper than the provider can give; IGN's copy goes deeper than Sentinel's", () => {
    for (const layer of SATELLITE_LAYERS) expect(layer.savedMaxzoom).toBeLessThanOrEqual(layer.maxzoom);
    expect(IGN.savedMaxzoom).toBeGreaterThan(SENTINEL.savedMaxzoom);
  });

  it("knows IGN has no photo over Kyiv, and Sentinel has one everywhere", () => {
    const vincennes = { s: 48.835, w: 2.41, n: 48.856, e: 2.46 };
    const kyiv = { s: 50.428, w: 30.485, n: 50.472, e: 30.565 };
    expect(layerCovers(IGN, vincennes)).toBe(true);
    expect(layerCovers(IGN, kyiv)).toBe(false);
    expect(layerCovers(SENTINEL, kyiv)).toBe(true);
  });

  it("reads the saved copy from the coordinator, under the saved map", () => {
    expect(SATELLITE_PATH.startsWith(BASEMAP_PATH)).toBe(true);
    expect(savedTileTemplate("satellite-ign")).toEqual([`${SATELLITE_PATH}/satellite-ign/{z}/{x}/{y}.jpg`]);
  });

  it("adds the layers under the units, hidden at first, and only once", () => {
    const map = fakeMap();
    addSatelliteLayers(map, "online");
    addSatelliteLayers(map, "online");

    expect(map.order).toEqual(["background", SATELLITE_LAYERS[0].id, SATELLITE_LAYERS[1].id, SATELLITE_BELOW, "pos"]);
    expect(map.sources.size).toBe(2);
    for (const layer of SATELLITE_LAYERS) {
      expect(map.layers.get(layer.id)?.layout?.visibility).toBe("none");
      expect(map.layers.get(layer.id)?.source).toBe(layer.id);
    }
    const ign = map.sources.get(IGN.id) as { tiles: string[]; maxzoom: number };
    expect(ign.tiles[0]).toBe(IGN.tiles[0]);
    expect(ign.maxzoom).toBe(IGN.maxzoom);
  });

  it("uses the saved photos and their shallower zoom when the map is saved", () => {
    const map = fakeMap();
    addSatelliteLayers(map, "saved");

    for (const layer of SATELLITE_LAYERS) {
      const source = map.sources.get(layer.id) as { tiles: string[]; maxzoom: number };
      expect(source.tiles).toEqual(savedTileTemplate(layer.id));
      expect(source.maxzoom).toBe(layer.savedMaxzoom);
    }
    // The order is the same: IGN still lies over Sentinel.
    expect(map.order).toEqual(["background", SATELLITE_LAYERS[0].id, SATELLITE_LAYERS[1].id, SATELLITE_BELOW, "pos"]);
  });

  it("shows and hides the layers without touching the others", () => {
    const map = fakeMap();
    addSatelliteLayers(map, "online");

    setSatelliteVisible(map, true);
    for (const layer of SATELLITE_LAYERS) expect(map.layers.get(layer.id)?.layout?.visibility).toBe("visible");

    setSatelliteVisible(map, false);
    for (const layer of SATELLITE_LAYERS) expect(map.layers.get(layer.id)?.layout?.visibility).toBe("none");
    expect(map.layers.get("start-fill")).toBeUndefined();
  });
});
