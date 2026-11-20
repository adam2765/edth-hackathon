/**
 * Builds data/gazetteer.vincennes.json from one Overpass query.
 * Run: npm run gazetteer
 * The running app never calls Overpass or Nominatim; it only reads the committed JSON.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import type { Category, GazetteerFeature } from "../lib/geo/types";
import { normalize } from "../lib/geo/normalize";

// S, W, N, E: Vincennes centre, the château and three Line 1 stations.
const BBOX = { s: 48.835, w: 2.41, n: 48.856, e: 2.46 };
const ENDPOINT = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
const query = `
[out:json][timeout:120];
(
  nwr["railway"~"^(station|halt)$"]["name"](${bb});
  nwr["public_transport"="station"]["name"](${bb});
  nwr["amenity"~"^(place_of_worship|townhall|school|college|university|kindergarten|hospital|clinic|police|post_office|library|theatre|cinema|marketplace|fire_station|arts_centre|community_centre)$"]["name"](${bb});
  nwr["office"="government"]["name"](${bb});
  nwr["historic"]["name"](${bb});
  nwr["tourism"~"^(museum|attraction|artwork|viewpoint|gallery)$"]["name"](${bb});
  nwr["leisure"~"^(park|garden|stadium|sports_centre)$"]["name"](${bb});
  nwr["landuse"="forest"]["name"](${bb});
  way["bridge"]["name"]["highway"!~"."](${bb});
  way["man_made"="bridge"]["name"](${bb});
  nwr["place"~"^(square|neighbourhood|quarter|locality)$"]["name"](${bb});
)->.poi;
.poi out tags bb;
way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service|footway)$"]["name"](${bb})->.streets;
.streets out tags geom;
`;

type OsmEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

function categorize(t: Record<string, string>): { category: Category; subtype: string } | null {
  const has = (k: string, re?: RegExp) => (re ? re.test(t[k] ?? "") : k in t);
  if (has("highway")) return { category: "street", subtype: t.highway };
  if (has("railway", /^(station|halt)$/) || has("public_transport", /^station$/)) {
    const sub = t.station === "subway" || t.subway === "yes" || /métro|metro/i.test(t.network ?? "") ? "metro" : /RER/i.test(`${t.network ?? ""} ${t.line ?? ""} ${t.route_ref ?? ""}`) ? "rer" : "rail";
    return { category: "metro_station", subtype: sub };
  }
  if (has("amenity", /^place_of_worship$/)) {
    return t.religion === "christian" ? { category: "church", subtype: t.building ?? "church" } : { category: "other", subtype: `place_of_worship:${t.religion ?? "unknown"}` };
  }
  if (has("amenity", /^townhall$/) || (has("office", /^government$/) && /mairie|hôtel de ville/i.test(t.name ?? ""))) return { category: "town_hall", subtype: "townhall" };
  if (has("historic", /^(castle|fort|manor|palace)$/)) return { category: "castle", subtype: t.historic };
  if (has("amenity", /^(school|college|university|kindergarten)$/)) return { category: "school", subtype: t.amenity };
  if (has("amenity", /^(hospital|clinic)$/)) return { category: "hospital", subtype: t.amenity };
  if (has("amenity", /^police$/)) return { category: "police", subtype: t.police ?? "police" };
  if (has("leisure", /^(park|garden)$/) || has("landuse", /^forest$/)) return { category: "park", subtype: t.leisure ?? t.landuse };
  if (has("bridge") || has("man_made", /^bridge$/)) return { category: "bridge", subtype: "bridge" };
  const sub = t.amenity ?? t.tourism ?? t.historic ?? t.leisure ?? t.place ?? t.office ?? "other";
  return { category: "other", subtype: sub };
}

function namesOf(t: Record<string, string>): string[] {
  const keys = ["name", "name:fr", "name:en", "alt_name", "short_name", "official_name", "old_name"];
  const out: string[] = [];
  for (const k of keys) {
    for (const v of (t[k] ?? "").split(";")) {
      const s = v.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Higher wins when duplicates are merged (a station node beats an entrance or a platform relation).
function priority(el: OsmEl): number {
  return el.type === "node" ? 3 : el.type === "way" ? 2 : 1;
}

async function main() {
  // Busy public servers return 429/502/504; back off and alternate between the main server and a mirror.
  const endpoints = [ENDPOINT, "https://overpass.private.coffee/api/interpreter"];
  let json: { elements: OsmEl[] } | null = null;
  for (let attempt = 0; attempt < 6 && !json; attempt++) {
    const url = endpoints[attempt % endpoints.length];
    console.log(`Querying Overpass at ${url} for bbox ${bb} (attempt ${attempt + 1}) ...`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "edth-voice-to-map-gazetteer/0.1" },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (res.ok) json = (await res.json()) as { elements: OsmEl[] };
      else console.log(`  ${res.status}: ${(await res.text()).slice(0, 80).replace(/\s+/g, " ")}`);
    } catch (e) {
      console.log(`  ${(e as Error).message}`);
    }
    if (!json) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  if (!json) throw new Error("Overpass unavailable after retries; existing data file left untouched");
  console.log(`Overpass returned ${json.elements.length} elements`);

  const pois: (GazetteerFeature & { _prio: number })[] = [];
  const streets = new Map<string, GazetteerFeature & { _prio: number }>();

  for (const el of json.elements) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const cat = categorize(t);
    if (!cat) continue;

    if (cat.category === "street") {
      if (!el.geometry?.length) continue;
      const line = el.geometry.map((p) => [r5(p.lon), r5(p.lat)] as [number, number]);
      const key = normalize(t.name);
      const existing = streets.get(key);
      if (existing) {
        existing.lines!.push(line);
        for (const n of namesOf(t)) if (!existing.names.includes(n)) existing.names.push(n);
      } else {
        streets.set(key, {
          id: `street/${key.replace(/ /g, "-")}`,
          name: t.name,
          names: namesOf(t),
          category: "street",
          subtype: cat.subtype,
          lat: 0,
          lon: 0,
          osm_type: "way",
          osm_id: el.id,
          lines: [line],
          _prio: 0,
        });
      }
      continue;
    }

    let lat = el.lat;
    let lon = el.lon;
    let bbox: [number, number, number, number] | undefined;
    if (el.bounds) {
      bbox = [r5(el.bounds.minlon), r5(el.bounds.minlat), r5(el.bounds.maxlon), r5(el.bounds.maxlat)];
      lat = (el.bounds.minlat + el.bounds.maxlat) / 2;
      lon = (el.bounds.minlon + el.bounds.maxlon) / 2;
    }
    if (lat == null || lon == null) continue;
    pois.push({
      id: `${el.type}/${el.id}`,
      name: t.name,
      names: namesOf(t),
      category: cat.category,
      subtype: cat.subtype,
      lat: r5(lat),
      lon: r5(lon),
      bbox,
      osm_type: el.type,
      osm_id: el.id,
      _prio: priority(el),
    });
  }

  // Finish streets: centre is the vertex nearest the bbox centre, so it always lies on the street.
  for (const s of streets.values()) {
    const pts = s.lines!.flat();
    const minLon = Math.min(...pts.map((p) => p[0]));
    const maxLon = Math.max(...pts.map((p) => p[0]));
    const minLat = Math.min(...pts.map((p) => p[1]));
    const maxLat = Math.max(...pts.map((p) => p[1]));
    const cLon = (minLon + maxLon) / 2;
    const cLat = (minLat + maxLat) / 2;
    let best = pts[0];
    let bestD = Infinity;
    for (const p of pts) {
      const d = (p[0] - cLon) ** 2 + (p[1] - cLat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    s.lon = best[0];
    s.lat = best[1];
    s.bbox = [minLon, minLat, maxLon, maxLat];
  }

  // Merge duplicate POIs: same normalised name, same category, within 300 m.
  pois.sort((a, b) => b._prio - a._prio);
  const merged: (GazetteerFeature & { _prio: number })[] = [];
  for (const p of pois) {
    const dup = merged.find(
      (m) => m.category === p.category && normalize(m.name) === normalize(p.name) && haversine(m.lat, m.lon, p.lat, p.lon) < 300,
    );
    if (dup) {
      for (const n of p.names) if (!dup.names.includes(n)) dup.names.push(n);
      const contains = (b: [number, number, number, number]) => dup.lon >= b[0] && dup.lon <= b[2] && dup.lat >= b[1] && dup.lat <= b[3];
      if (!dup.bbox && p.bbox && contains(p.bbox)) dup.bbox = p.bbox;
      continue;
    }
    merged.push(p);
  }

  const features: GazetteerFeature[] = [...merged, ...streets.values()].map(({ _prio, ...f }) => {
    void _prio;
    return f;
  });
  features.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  mkdirSync("data", { recursive: true });
  const out = {
    source: "OpenStreetMap via Overpass API (© OpenStreetMap contributors, ODbL)",
    built_at: new Date().toISOString(),
    bbox: BBOX,
    count: features.length,
    features,
  };
  writeFileSync("data/gazetteer.vincennes.json", JSON.stringify(out));

  const counts: Record<string, number> = {};
  for (const f of features) counts[f.category] = (counts[f.category] ?? 0) + 1;
  console.log(`Wrote ${features.length} features`, counts);
  for (const c of ["metro_station", "church", "castle", "town_hall"]) {
    console.log(`\n${c}:`);
    for (const f of features.filter((x) => x.category === c)) console.log(`  ${f.id}  ${f.name}  [${f.subtype}]  ${f.lat},${f.lon}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
