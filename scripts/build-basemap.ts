/**
 * Saves what the map needs to draw with no internet, into public/basemap/ (not in git):
 * OpenFreeMap's "liberty" style, the vector tiles over one area from zoom 0 to 14, the low-zoom
 * shaded relief, the fonts the labels in those tiles need, and the icons.
 *
 * Run: npm run basemap -- vincennes     (or kyiv, izium; one area per run, each adds to the folder)
 *      npm run basemap -- vincennes --fresh   fetch again what is already saved
 *      npm run basemap -- --labels      refresh the label fonts that are in git (public/glyphs/)
 *
 * The running app never calls OpenFreeMap in offline mode; it reads these files (lib/map/baseMap.ts).
 * Restart the coordinator after a run: `next start` lists the files in public/ once, when it starts.
 *
 * OpenFreeMap's terms for offline downloads (openfreemap.org/tos, read on 22 Nov 2026): one
 * download is at most 3,000 tiles or 50 MB, with at most 4 requests at a time and a User-Agent that
 * names the app. The script counts both and stops before it would go over.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { StyleSpecification } from "maplibre-gl";
import { AREAS, isAreaId, type AreaId } from "../lib/geo/areas";
import { HOSTED_STYLE_URL } from "../lib/map/baseMap";
import {
  BASEMAP_PATH,
  LABEL_FONTS,
  LABEL_RANGES,
  fontStacks,
  glyphRanges,
  localStyle,
  outsideAddresses,
  tilePlan,
  tileStrings,
  type Tile,
  type TileIndex,
} from "../lib/map/offline";

const USER_AGENT = "voice-to-map/0.1 (offline base map download)";
const MAX_TILES = 3000;
// 2 MB under the 50 MB limit: up to four answers are still on their way when the count is checked.
const MAX_BYTES = 48 * 1024 * 1024;
const PARALLEL = 4;
const OUT = path.join("public", BASEMAP_PATH);
const LABELS_OUT = path.join("public", "glyphs");

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const labelsOnly = args.includes("--labels");
const names = args.filter((a) => !a.startsWith("--"));
if (names.length > 1 || (labelsOnly && names.length) || (names[0] && !isAreaId(names[0]))) {
  console.error(`Use: npm run basemap -- <area> [--fresh]   or   npm run basemap -- --labels\nAreas: ${Object.keys(AREAS).join(", ")}. One area per run.`);
  process.exit(1);
}
const areaId = (names[0] ?? "vincennes") as AreaId;

// ---------- fetching, within the terms ----------

let bytes = 0;
let requests = 0;

interface Got {
  status: number;
  body: Buffer;
}

/** One GET. Counts the bytes as they come over the wire (compressed), which is what the limit is about. */
function getOnce(url: string): Promise<Got> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" }, timeout: 30_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("error", reject);
      res.on("end", () => {
        const wire = Buffer.concat(chunks);
        bytes += wire.length;
        try {
          resolve({ status: res.statusCode ?? 0, body: res.headers["content-encoding"] === "gzip" ? gunzipSync(wire) : wire });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timed out: ${url}`)));
    req.on("error", reject);
  });
}

async function get(url: string): Promise<Got> {
  for (let attempt = 1; ; attempt++) {
    if (bytes > MAX_BYTES) throw new Error(`Stopped at ${mb(bytes)}: one download may be 50 MB at most (OpenFreeMap's terms). What was saved stays. A larger area needs OpenFreeMap's yes first, or a smaller margin.`);
    requests++;
    try {
      const got = await getOnce(url);
      if (got.status < 500 || attempt === 3) return got;
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

/** Runs the jobs four at a time. The first failure stops the rest. */
async function pool<T>(items: T[], job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (next < items.length && !failed) {
      const item = items[next++];
      try {
        await job(item);
      } catch (e) {
        failed = e;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (failed) throw failed;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const fill = (template: string, t: Tile) => template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));

function save(file: string, body: Buffer | string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

async function json<T>(url: string): Promise<T> {
  const got = await get(url);
  if (got.status !== 200) throw new Error(`${url}: HTTP ${got.status}`);
  return JSON.parse(got.body.toString("utf8")) as T;
}

/** Saves the tiles that are not on disk yet. A tile the server does not have (sea, mostly) is left out. */
async function saveTiles(tiles: Tile[], template: string, dir: string, ext: string): Promise<{ saved: number; kept: number; absent: number }> {
  const count = { saved: 0, kept: 0, absent: 0 };
  const todo = tiles.filter((t) => {
    const have = !fresh && existsSync(path.join(dir, `${t.z}/${t.x}/${t.y}.${ext}`));
    if (have) count.kept++;
    return !have;
  });
  await pool(todo, async (t) => {
    const got = await get(fill(template, t));
    if (got.status === 404 || got.status === 204) {
      count.absent++;
      return;
    }
    if (got.status !== 200) throw new Error(`${fill(template, t)}: HTTP ${got.status}`);
    save(path.join(dir, `${t.z}/${t.x}/${t.y}.${ext}`), got.body);
    count.saved++;
  });
  return count;
}

/** Saves the font files that are not on disk yet. A range the server does not have is skipped: MapLibre draws those letters itself. */
async function saveGlyphs(template: string, fonts: string[], ranges: number[], dir: string, again: boolean): Promise<number> {
  const todo = fonts.flatMap((font) => ranges.map((range) => ({ font, range }))).filter(({ font, range }) => again || !existsSync(path.join(dir, font, `${range}-${range + 255}.pbf`)));
  let saved = 0;
  await pool(todo, async ({ font, range }) => {
    const name = `${range}-${range + 255}`;
    const url = template.replace("{fontstack}", encodeURIComponent(font)).replace("{range}", name);
    const got = await get(url);
    if (got.status === 404) return console.warn(`  no font file ${font} ${name} on the server; skipped`);
    if (got.status !== 200) throw new Error(`${url}: HTTP ${got.status}`);
    save(path.join(dir, font, `${name}.pbf`), got.body);
    saved++;
  });
  return saved;
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// ---------- the run ----------

interface Manifest {
  source: string;
  attribution: string;
  areas: Record<string, { fetched: string; tiles: string; vector: number; raster: number }>;
}

async function main() {
  const hosted = await json<StyleSpecification>(HOSTED_STYLE_URL);

  if (labelsOnly) {
    const saved = await saveGlyphs(hosted.glyphs!, LABEL_FONTS, LABEL_RANGES, LABELS_OUT, true);
    console.log(`Saved ${saved} label font files in ${LABELS_OUT}/ (${requests} requests, ${mb(bytes)}).`);
    return;
  }

  // The tile index is fetched once here and written into the saved style.
  const indexes = new Map<string, TileIndex>();
  for (const source of Object.values(hosted.sources)) {
    const url = (source as { type: string; url?: string }).url;
    if (source.type === "vector" && typeof url === "string") indexes.set(url, await json<TileIndex>(url));
  }
  const local = localStyle(hosted, (url) => indexes.get(url)!);
  const left = outsideAddresses(local.style);
  if (left.length) throw new Error(`The saved style would still ask another host: ${left.join(", ")}`);

  const area = AREAS[areaId];
  const vector = tilePlan(area.bbox, local.vectorZoom.min, local.vectorZoom.max);
  const rasters = local.rasters.map((r) => ({ ...r, tiles: tilePlan(area.bbox, 0, r.maxzoom) }));
  const total = vector.length + rasters.reduce((n, r) => n + r.tiles.length, 0);
  if (total > MAX_TILES) throw new Error(`${area.label} needs ${total} tiles: one download may be 3,000 at most (OpenFreeMap's terms).`);
  console.log(`${area.label}: ${vector.length} vector tiles, zoom ${local.vectorZoom.min} to ${local.vectorZoom.max}, from ${local.vectorTemplate}`);

  const v = await saveTiles(vector, local.vectorTemplate, path.join(OUT, "tiles"), "pbf");
  console.log(`  vector tiles: ${v.saved} saved, ${v.kept} already here, ${v.absent} not on the server`);
  let rasterCount = 0;
  for (const r of rasters) {
    const got = await saveTiles(r.tiles, r.template, path.join(OUT, r.id), r.ext);
    rasterCount += r.tiles.length;
    console.log(`  ${r.id}: ${got.saved} saved, ${got.kept} already here, ${got.absent} not on the server`);
  }

  // Fonts: what the labels in every saved tile are written in (all areas), and the app's own labels.
  const tileFiles = filesUnder(path.join(OUT, "tiles"));
  const letters = new Set<number>(LABEL_RANGES);
  for (const file of tileFiles) for (const range of glyphRanges(tileStrings(readFileSync(file)))) letters.add(range);
  const fonts = [...new Set([...fontStacks(hosted), ...LABEL_FONTS])];
  const ranges = [...letters].sort((a, b) => a - b);
  const glyphs = await saveGlyphs(local.glyphs, fonts, ranges, path.join(OUT, "fonts"), fresh);
  console.log(`  fonts: ${fonts.length} fonts x ${ranges.length} ranges, ${glyphs} files saved`);

  // Icons, at both sizes.
  const spriteName = local.sprite.split("/").pop()!;
  for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) {
    if (!fresh && existsSync(path.join(OUT, "sprites", spriteName + suffix))) continue;
    const got = await get(local.sprite + suffix);
    if (got.status !== 200) throw new Error(`${local.sprite + suffix}: HTTP ${got.status}`);
    save(path.join(OUT, "sprites", spriteName + suffix), got.body);
  }

  const manifestFile = path.join(OUT, "manifest.json");
  const manifest: Manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : { source: "", attribution: "", areas: {} };
  manifest.source = HOSTED_STYLE_URL;
  manifest.attribution = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap. Fonts: Noto Sans (SIL Open Font License 1.1). Icons: Maki (CC0). Relief: Natural Earth (public domain).";
  manifest.areas[area.id] = { fetched: new Date().toISOString(), tiles: local.vectorTemplate, vector: vector.length, raster: rasterCount };
  save(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  // The style goes last: the map only uses a saved map whose style is there.
  save(path.join(OUT, "style.json"), JSON.stringify(local.style) + "\n");

  const onDisk = filesUnder(OUT);
  console.log(`Done: ${requests} requests, ${mb(bytes)} downloaded. ${OUT}/ now holds ${onDisk.length} files for ${Object.keys(manifest.areas).join(", ")}.`);
  console.log("Restart the coordinator (npm start) so it serves the new files.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
