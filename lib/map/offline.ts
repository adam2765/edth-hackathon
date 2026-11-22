/**
 * The saved base map: which tiles to save for an area, which font files their labels need, and the
 * style rewritten to read all of it from the coordinator. Pure functions, used by
 * scripts/build-basemap.ts; nothing here touches the network or the disk.
 */
import type { StyleSpecification } from "maplibre-gl";

export interface Tile {
  z: number;
  x: number;
  y: number;
}
export interface Bbox {
  s: number;
  w: number;
  n: number;
  e: number;
}

/** Where the saved files live under public/, and so the path the coordinator serves them at. */
export const BASEMAP_PATH = "/basemap";

/** The tile that holds a point, in the usual web map numbering. */
export function tileAt(lat: number, lon: number, z: number): Tile {
  const n = 2 ** z;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  const rad = (lat * Math.PI) / 180;
  return { z, x: clamp(((lon + 180) / 360) * n), y: clamp(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n) };
}

/**
 * How many tiles to save around the area's own, at one zoom. Two from zoom 12 up, where the map is
 * used and panned; one from 8 to 11; none below, where one tile already shows a whole country.
 * A tile that was not saved is drawn from the saved tile above it, with less detail.
 */
export function marginAt(z: number): number {
  return z >= 12 ? 2 : z >= 8 ? 1 : 0;
}

/** The tiles that cover a box at one zoom, with `margin` more tiles on every side. */
export function tilesAt(bbox: Bbox, z: number, margin: number): Tile[] {
  const n = 2 ** z;
  const a = tileAt(bbox.n, bbox.w, z);
  const b = tileAt(bbox.s, bbox.e, z);
  const tiles: Tile[] = [];
  for (let x = Math.max(0, a.x - margin); x <= Math.min(n - 1, b.x + margin); x++)
    for (let y = Math.max(0, a.y - margin); y <= Math.min(n - 1, b.y + margin); y++) tiles.push({ z, x, y });
  return tiles;
}

/** Every tile to save for an area, from `minzoom` to `maxzoom`. */
export function tilePlan(bbox: Bbox, minzoom: number, maxzoom: number): Tile[] {
  const tiles: Tile[] = [];
  for (let z = minzoom; z <= maxzoom; z++) tiles.push(...tilesAt(bbox, z, marginAt(z)));
  return tiles;
}

// ---------- reading a vector tile's text ----------

function varint(buf: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let scale = 1;
  for (;;) {
    if (pos >= buf.length) throw new Error("vector tile cut short");
    const byte = buf[pos++];
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return [value, pos];
    scale *= 128;
  }
}

/** Calls `each` for every length-delimited field of a protobuf message; skips the other kinds. */
function fields(buf: Uint8Array, start: number, end: number, each: (tag: number, from: number, to: number) => void): void {
  let pos = start;
  while (pos < end) {
    let key: number;
    [key, pos] = varint(buf, pos);
    const wire = key % 8;
    if (wire === 0) [, pos] = varint(buf, pos);
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) {
      let len: number;
      [len, pos] = varint(buf, pos);
      each(Math.floor(key / 8), pos, pos + len);
      pos += len;
    } else throw new Error(`vector tile: unknown wire type ${wire}`);
  }
}

/**
 * Every text value in a vector tile (Mapbox Vector Tile format): place and street names, and also
 * class names, which are plain Latin and cost nothing. Tile > layers (3) > values (4) > string (1).
 */
export function tileStrings(tile: Uint8Array): string[] {
  const out: string[] = [];
  const utf8 = new TextDecoder();
  fields(tile, 0, tile.length, (tag, from, to) => {
    if (tag !== 3) return;
    fields(tile, from, to, (layerTag, vFrom, vTo) => {
      if (layerTag !== 4) return;
      fields(tile, vFrom, vTo, (valueTag, sFrom, sTo) => {
        if (valueTag === 1) out.push(utf8.decode(tile.subarray(sFrom, sTo)));
      });
    });
  });
  return out;
}

// ---------- fonts ----------

/**
 * Characters MapLibre 6 draws with a font of the computer and never asks the glyph server for:
 * Chinese, Japanese and Korean, and the scripts whose letters join (Devanagari to Thai and so on).
 * The same blocks as its `codePointUsesLocalIdeographFontFamily` and `codePointIsInComplexShapingScript`.
 */
const DRAWN_BY_THE_BROWSER =
  /[˪˫ऀ-႟ᄀ-ᇿᜀ-៿ᤀ-᥏᧠-᪯ᬀ-ᱏ᳀-᳏⺀-⿟　-ヿㄅ-ㄯㄱ-ㆎㆠ-䶿一-ꒌ꒐-꓆ꠀ-꠯ꢀ-ꣿꤰ-ꥼꦀ-꫿ꯀ-꯿가-ퟆퟋ-ퟻ豈-舘並-龎︐-︟︰-﹏＀-￯]/;

/**
 * The glyph files a set of labels needs: the first code point of each block of 256, as in
 * "1024-1279.pbf". A file that is missing is not fatal: MapLibre then draws those letters itself.
 */
export function glyphRanges(strings: Iterable<string>): number[] {
  const ranges = new Set<number>();
  for (const s of strings)
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp > 0xffff || DRAWN_BY_THE_BROWSER.test(ch)) continue;
      ranges.add(Math.floor(cp / 256) * 256);
    }
  return [...ranges].sort((a, b) => a - b);
}

/** The app's own labels: unit and track names, times, the start point. */
export const LABEL_FONTS = ["Noto Sans Regular", "Noto Sans Bold"];
/**
 * What those labels are written in: Latin with French accents, Cyrillic, dashes and quotes,
 * "№" and arrows, "≈". Always saved, whatever the tiles hold.
 */
export const LABEL_RANGES = [0, 256, 1024, 8192, 8448, 8704];

const isFontList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");

function collectFonts(v: unknown, plain: boolean, out: Set<string>): void {
  if (Array.isArray(v)) {
    if (plain && isFontList(v)) out.add(v.join(","));
    else if (v[0] === "literal" && isFontList(v[1])) out.add(v[1].join(","));
    else for (const x of v) collectFonts(x, false, out);
  } else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // An old-style function: { stops: [[zoom, ["Font"]], ...] }.
    if (Array.isArray(o.stops)) for (const stop of o.stops) if (Array.isArray(stop)) collectFonts(stop[1], true, out);
    for (const [k, x] of Object.entries(o)) if (k !== "stops") collectFonts(x, k === "text-font", out);
  }
}

/** Every font a style's labels name, as MapLibre asks for it: the list joined with commas. */
export function fontStacks(style: StyleSpecification): string[] {
  const out = new Set<string>();
  for (const layer of style.layers) {
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    if (!layout) continue;
    collectFonts(layout["text-font"], true, out);
    // A "format" label may switch font for one part of the text.
    collectFonts(layout["text-field"], false, out);
  }
  return [...out].sort();
}

// ---------- the style ----------

export interface TileIndex {
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
}

/** A raster source the style draws, and where its tiles come from and go. */
export interface RasterSource {
  id: string;
  template: string;
  maxzoom: number;
  ext: string;
}

export interface LocalStyle {
  style: StyleSpecification;
  /** The address the vector tiles are fetched from, with {z}/{x}/{y}. */
  vectorTemplate: string;
  vectorZoom: { min: number; max: number };
  rasters: RasterSource[];
  /** The address of the hosted sprite, without ".png" or ".json". */
  sprite: string;
  /** The address of the hosted fonts, with {fontstack} and {range}. */
  glyphs: string;
}

/**
 * The hosted style rewritten to read everything from the coordinator. The tile index is written
 * into the style, so the map asks for nothing else before its first tile. Addresses start at the
 * coordinator's root; the browser completes them (withOrigin in baseMap.ts).
 *
 * It knows the shape "liberty" has today: one vector source with a tile index, raster sources with
 * a tile address, one sprite. Anything else stops the script: a source it does not save would be a
 * request to another host.
 */
export function localStyle(style: StyleSpecification, index: (url: string) => TileIndex): LocalStyle {
  const sources: Record<string, unknown> = {};
  const rasters: RasterSource[] = [];
  let vectorTemplate = "";
  let vectorZoom = { min: 0, max: 14 };
  for (const [id, source] of Object.entries(style.sources)) {
    const s = source as { type: string; url?: string; tiles?: string[]; maxzoom?: number };
    if (s.type === "vector" && typeof s.url === "string" && !vectorTemplate) {
      const tj = index(s.url);
      vectorTemplate = tj.tiles[0];
      vectorZoom = { min: tj.minzoom ?? 0, max: tj.maxzoom ?? 14 };
      sources[id] = {
        type: "vector",
        tiles: [`${BASEMAP_PATH}/tiles/{z}/{x}/{y}.pbf`],
        minzoom: vectorZoom.min,
        maxzoom: vectorZoom.max,
        // Only the tiles around our areas are saved. With `sparse` (MapLibre 6), a tile that is not
        // there is drawn from the nearest saved tile above it, coarser; without it, it stays empty.
        sparse: true,
        ...(tj.attribution ? { attribution: tj.attribution } : {}),
      };
    } else if (s.type === "raster" && s.tiles?.length && typeof s.maxzoom === "number") {
      const ext = /\.(png|jpg|jpeg|webp)(?:$|\?)/.exec(s.tiles[0])?.[1] ?? "png";
      rasters.push({ id, template: s.tiles[0], maxzoom: s.maxzoom, ext });
      sources[id] = { ...s, tiles: [`${BASEMAP_PATH}/${id}/{z}/{x}/{y}.${ext}`] };
    } else throw new Error(`The style has a source this script does not know how to save: "${id}" (${s.type})`);
  }
  if (!vectorTemplate) throw new Error("The style has no vector source with a tile index");
  if (typeof style.sprite !== "string") throw new Error("The style has no single sprite");
  if (!style.glyphs) throw new Error("The style names no fonts address");
  const name = style.sprite.split("/").pop()!;
  return {
    style: {
      ...style,
      sources: sources as StyleSpecification["sources"],
      sprite: `${BASEMAP_PATH}/sprites/${name}`,
      glyphs: `${BASEMAP_PATH}/fonts/{fontstack}/{range}.pbf`,
    },
    vectorTemplate,
    vectorZoom,
    rasters,
    sprite: style.sprite,
    glyphs: style.glyphs,
  };
}

/** Every address in a style that leaves the coordinator. Empty for a saved style that is whole. */
export function outsideAddresses(style: StyleSpecification): string[] {
  const out: string[] = [];
  const check = (u: unknown) => {
    if (typeof u === "string" && /^(https?:)?\/\//.test(u)) out.push(u);
  };
  check(style.glyphs);
  if (typeof style.sprite === "string") check(style.sprite);
  else for (const s of style.sprite ?? []) check(s.url);
  for (const source of Object.values(style.sources)) {
    const s = source as { url?: string; tiles?: string[]; data?: unknown };
    check(s.url);
    for (const t of s.tiles ?? []) check(t);
    check(s.data);
  }
  return out;
}
