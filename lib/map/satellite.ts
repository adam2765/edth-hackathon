/**
 * A photo view under the command post's map [260, 261]. IGN's orthophotos cover France; a Sentinel-2
 * cloudless mosaic covers the rest, so Kyiv and Izium are not left blank. Both are European
 * services. The layers are added under every unit and track, and stay hidden until the operator
 * asks for them.
 *
 * The photographs come from the internet, or from the copy `npm run basemap` saves for an area, so
 * the button works with no internet too [261]. A tile that was not saved draws nothing and the map
 * under it shows through.
 */
import type { Map as MLMap, RasterSourceSpecification } from "maplibre-gl";

export interface SatelliteLayer {
  id: string;
  /** The provider's tile address, with {z}, {y} and {x} filled in by MapLibre. */
  tiles: [string];
  /** The provider's deepest zoom. */
  maxzoom: number;
  /** The deepest zoom the offline script saves: photos are large, so it stops sooner than the provider. */
  savedMaxzoom: number;
  /** True when the photos cover the whole world. IGN's cover metropolitan France only. */
  worldwide: boolean;
  attribution: string;
}

/** How deep the offline copy goes, and the shallowest zoom worth a photo. Below, one tile is a country. */
export const SATELLITE_MINZOOM = 8;

/** Under public/, where the script writes the photos; on the coordinator, the address MapLibre reads. */
export const SATELLITE_FILES = "basemap/satellite";
export const SATELLITE_PATH = `/${SATELLITE_FILES}`;
export const SATELLITE_EXT = "jpg";

/** The Sentinel mosaic is 10 m a pixel: enough to see a town, not a street. IGN's is a photo of France. */
export const SATELLITE_LAYERS: SatelliteLayer[] = [
  {
    id: "satellite-sentinel",
    tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
    maxzoom: 14,
    savedMaxzoom: 14,
    worldwide: true,
    // The text and links the licence asks for: CC BY-NC-SA 4.0, non-commercial, from 2018 to 2024.
    attribution:
      '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2020)',
  },
  {
    id: "satellite-ign",
    tiles: [
      "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    ],
    maxzoom: 19,
    savedMaxzoom: 19,
    worldwide: false,
    // Licence Ouverte 2.0 (Etalab): reuse and offline copies are allowed, with the source named.
    attribution: '© <a href="https://www.ign.fr" target="_blank" rel="noreferrer">IGN</a> – Géoplateforme (Licence Ouverte 2.0)',
  },
];

/** Metropolitan France, roughly: IGN's orthophotos stop at its border. */
export const FRANCE_BBOX = { s: 41.2, w: -5.5, n: 51.3, e: 9.8 };

/** Whether a layer has a photo over a whole box, so the script need not ask for tiles it has not. */
export function layerCovers(layer: SatelliteLayer, box: { s: number; w: number; n: number; e: number }): boolean {
  return layer.worldwide || (box.s >= FRANCE_BBOX.s && box.n <= FRANCE_BBOX.n && box.w >= FRANCE_BBOX.w && box.e <= FRANCE_BBOX.e);
}

/** The first layer the page draws: the photo view goes under it, over the base map. */
export const SATELLITE_BELOW = "start-fill";

/** Where MapLibre reads a saved photo: z/x/y, the order the files are written in. */
export function savedTileTemplate(id: string): [string] {
  return [`${SATELLITE_PATH}/${id}/{z}/{x}/{y}.${SATELLITE_EXT}`];
}

/** A saved photo's path from public/, as `npm run basemap` writes it. */
export function savedTileFile(id: string, tile: { z: number; x: number; y: number }): string {
  return `${SATELLITE_FILES}/${id}/${tile.z}/${tile.x}/${tile.y}.${SATELLITE_EXT}`;
}

export type SatelliteMode = "online" | "saved";

/**
 * Adds the photo layers once, in the order they are listed, so IGN (where it has a photo) lies over
 * Sentinel and a tile IGN does not have lets Sentinel show. Safe to call twice.
 *
 * `saved` reads the copy on the coordinator instead of the two services; the map's base says which
 * one is in use, so a page with the saved map also reads saved photos [261].
 */
export function addSatelliteLayers(map: MLMap, mode: SatelliteMode = "online"): void {
  for (const layer of SATELLITE_LAYERS) {
    const saved = mode === "saved";
    if (!map.getSource(layer.id)) {
      const source: RasterSourceSpecification = {
        type: "raster",
        tiles: saved ? savedTileTemplate(layer.id) : layer.tiles,
        tileSize: 256,
        maxzoom: saved ? layer.savedMaxzoom : layer.maxzoom,
        attribution: layer.attribution,
      };
      map.addSource(layer.id, source);
    }
    if (map.getLayer(layer.id)) continue;
    map.addLayer(
      {
        id: layer.id,
        type: "raster",
        source: layer.id,
        // Hidden at first, so a page that never asks for a photograph downloads none.
        layout: { visibility: "none" },
        // Nothing tints the photo: the symbols are drawn above it, with their white halos.
        paint: { "raster-opacity": 1 },
      },
      map.getLayer(SATELLITE_BELOW) ? SATELLITE_BELOW : undefined,
    );
  }
}

/** Shows or hides the photo view. Nothing else on the map changes. */
export function setSatelliteVisible(map: MLMap, on: boolean): void {
  for (const layer of SATELLITE_LAYERS) {
    if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", on ? "visible" : "none");
  }
}
