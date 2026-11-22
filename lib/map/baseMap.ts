/**
 * Which map style the map pages start with. Safe to import on the client.
 *
 *   hosted  OpenFreeMap's "liberty" style, from the internet
 *   local   the copy saved on the coordinator by `npm run basemap` (public/basemap/, not in git)
 *   none    a plain background, so units, tracks and their labels still draw
 *
 * The coordinator says which of the first two it prefers (GET /api/basemap). The other one is tried
 * next, then the plain background. MapLibre adds the map's layers only after its style has loaded,
 * so a style that cannot be fetched would leave the map empty: the style is fetched here first.
 */
import type { StyleSpecification } from "maplibre-gl";

export const HOSTED_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Written by scripts/build-basemap.ts, with addresses that start at the coordinator's root. */
export const LOCAL_STYLE_PATH = "/basemap/style.json";
/** The label fonts in git (public/glyphs/): Noto Sans Regular and Bold, Latin and Cyrillic. */
export const LABEL_GLYPHS_PATH = "/glyphs/{fontstack}/{range}.pbf";

export type BaseMapSource = "hosted" | "local" | "none";
export type BaseMapPreference = "hosted" | "local";

export interface BaseMap {
  source: BaseMapSource;
  /** Given to MapLibre as the map's style. */
  style: StyleSpecification;
  /** Shown in the map's corner, after what the style's own sources say. */
  attribution: string[];
}

const OSM = "© OpenStreetMap contributors";
/** The small note in the map's corner when there is no base map. */
export const NO_BASE_MAP_NOTE = '<span class="basemap-note">Base map not available. Units and tracks still draw.</span>';

/** How long the hosted style may take before the next one is tried. */
const HOSTED_TIMEOUT_MS = 5000;

/** The plain background: no tiles, and the label fonts from this coordinator. */
export function plainStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    name: "Plain background (no base map)",
    glyphs: origin + LABEL_GLYPHS_PATH,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0f2" } }],
  };
}

const rooted = (url: string, origin: string) => (url.startsWith("/") && !url.startsWith("//") ? origin + url : url);

/**
 * The saved style holds addresses from the coordinator's root ("/basemap/tiles/..."), because the
 * script cannot know the name or port the browser will use. MapLibre needs whole addresses for the
 * sprite, so every one is completed here.
 */
export function withOrigin(style: StyleSpecification, origin: string): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  for (const [id, source] of Object.entries(style.sources)) {
    const s = { ...source } as { url?: string; tiles?: string[] };
    if (typeof s.url === "string") s.url = rooted(s.url, origin);
    if (Array.isArray(s.tiles)) s.tiles = s.tiles.map((t) => rooted(t, origin));
    sources[id] = s as StyleSpecification["sources"][string];
  }
  const sprite =
    typeof style.sprite === "string" ? rooted(style.sprite, origin) : style.sprite?.map((s) => ({ ...s, url: rooted(s.url, origin) }));
  return { ...style, sources, ...(sprite ? { sprite } : {}), ...(style.glyphs ? { glyphs: rooted(style.glyphs, origin) } : {}) };
}

/** A style worth giving to MapLibre: version 8 with layers. A "not found" page is not one. */
export function isStyle(x: unknown): x is StyleSpecification {
  const s = x as { version?: unknown; layers?: unknown; sources?: unknown } | null;
  return !!s && typeof s === "object" && s.version === 8 && Array.isArray(s.layers) && typeof s.sources === "object" && s.sources !== null;
}

/** Which styles to try, in order. */
export function styleOrder(prefer: BaseMapPreference): ("hosted" | "local")[] {
  return prefer === "local" ? ["local", "hosted"] : ["hosted", "local"];
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function json(fetcher: Fetcher, url: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetcher(url, init);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The style to start the map with. Never throws: with no network and no saved map it returns the
 * plain background. The hosted style is asked for past the browser's cache, because a cached style
 * with no network behind it gives a map whose fonts never arrive.
 */
export async function loadBaseMap(fetcher: Fetcher = fetch, origin: string = window.location.origin): Promise<BaseMap> {
  const said = (await json(fetcher, "/api/basemap", { cache: "no-store" })) as { prefer?: unknown } | null;
  const prefer: BaseMapPreference = said?.prefer === "local" ? "local" : "hosted";
  for (const source of styleOrder(prefer)) {
    const style =
      source === "local"
        ? await json(fetcher, LOCAL_STYLE_PATH, { cache: "no-store" })
        : await json(fetcher, HOSTED_STYLE_URL, { cache: "no-store", signal: AbortSignal.timeout(HOSTED_TIMEOUT_MS) });
    if (!isStyle(style)) continue;
    if (source === "local") return { source, style: withOrigin(style, origin), attribution: ["Map saved on this computer", OSM] };
    return { source, style, attribution: [OSM] };
  }
  return { source: "none", style: plainStyle(origin), attribution: [NO_BASE_MAP_NOTE, OSM] };
}
