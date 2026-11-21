/**
 * Builds data/gazetteer.<area>.json from one Overpass query.
 * Run: npm run gazetteer -- vincennes   (or: kyiv)
 * The running app never calls Overpass or Nominatim; it only reads the committed JSON.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import type { Category, GazetteerFeature } from "../lib/geo/types";
import { normalize, transliterateUk } from "../lib/geo/normalize";
import { AREAS, isAreaId } from "../lib/geo/areas";
import { groupStreetPieces, joinSameTown } from "../lib/geo/streets";
import { canonTokens, categoryOfToken } from "../lib/geo/gazetteer";
import { nearestPointOnLines } from "../lib/geo/geo";

const areaArg = process.argv[2] ?? "vincennes";
if (!isAreaId(areaArg)) {
  console.error(`Unknown area "${areaArg}". Known: ${Object.keys(AREAS).join(", ")}`);
  process.exit(1);
}
const AREA = AREAS[areaArg];
const BBOX = AREA.bbox;
const OUT_FILE = `data/gazetteer.${AREA.id}.json`;
const ENDPOINT = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
// Roads include tracks, paths and bridleways: the Bois de Vincennes roads closed to cars are mapped
// as tracks ("Route de la Dame Blanche"). Cycleways are left out: here they are the lane beside a
// road that is already in, or a misspelt copy of its name.
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
  nwr["landuse"="cemetery"]["name"](${bb});
  nwr["amenity"="grave_yard"]["name"](${bb});
  way["bridge"]["name"]["highway"!~"."](${bb});
  way["man_made"="bridge"]["name"](${bb});
  nwr["place"~"^(square|neighbourhood|quarter|locality)$"]["name"](${bb});
  nwr["highway"="bus_stop"]["name"](${bb});
  nwr["railway"="tram_stop"]["name"](${bb});
  nwr["public_transport"="platform"]["name"]["railway"!~"."](${bb});
  nwr["amenity"~"^(fuel|pharmacy)$"](${bb});
  nwr["tourism"~"^(hotel|hostel|guest_house|motel)$"]["name"](${bb});
  nwr["natural"="water"]["name"](${bb});
  way["building"]["name"][!"shop"][!"amenity"][!"tourism"][!"office"][!"craft"][!"healthcare"][!"leisure"][!"historic"](${bb});
)->.poi;
.poi out tags bb;
way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service|footway|track|path|bridleway)$"]["name"](${bb})->.streets;
.streets out tags geom;
way["waterway"~"^(river|canal|stream)$"]["name"](${bb})->.rivers;
.rivers out tags geom;
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

/**
 * Military offices and sites are left out: the gazetteer is streets and civilian landmarks only.
 * By tag, or by name for an enlistment office mapped as a plain government office ("Військкомат",
 * also spelt with a Latin i). Streets named after units are street names and stay. So does a
 * museum piece (`historic`), and anything that only stands on military land (`landuse`): the
 * Bégin hospital in Saint-Mandé is a hospital first.
 */
const MILITARY_NAME = /в[iі]йськкомат|во[еє]нкомат|(?<![\p{L}])ТЦК(?![\p{L}])|центр\S* комплектування|військов\S* частин|воинск\S* част/iu;
function isMilitary(t: Record<string, string>): boolean {
  if (("military" in t && !("historic" in t)) || t.office === "military" || t.government === "military") return true;
  return ["name", "name:uk", "name:ru", "official_name", "alt_name"].some((k) => MILITARY_NAME.test(t[k] ?? ""));
}

function categorize(t: Record<string, string>): { category: Category; subtype: string } | null {
  const has = (k: string, re?: RegExp) => (re ? re.test(t[k] ?? "") : k in t);
  // A bus station ("автостанція") is where buses stop, not a rail station: "the station" must not mean it.
  if (has("amenity", /^bus_station$/) && !has("railway")) return { category: "stop", subtype: "bus_station" };
  // Before streets: a bus stop is tagged highway=bus_stop. Metro platforms (railway=platform) are not stops.
  if (has("highway", /^bus_stop$/) || has("railway", /^tram_stop$/) || (has("public_transport", /^platform$/) && !has("railway"))) {
    const sub = has("railway", /^tram_stop$/) || t.tram === "yes" ? "tram" : t.trolleybus === "yes" ? "trolleybus" : "bus";
    return { category: "stop", subtype: sub };
  }
  if (has("highway")) return { category: "street", subtype: t.highway };
  if (has("railway", /^(station|halt)$/) || has("public_transport", /^station$/)) {
    const sub = t.station === "subway" || t.subway === "yes" || /métro|metro/i.test(t.network ?? "") ? "metro" : /RER/i.test(`${t.network ?? ""} ${t.line ?? ""} ${t.route_ref ?? ""}`) ? "rer" : "rail";
    return { category: "metro_station", subtype: sub };
  }
  if (has("amenity", /^place_of_worship$/)) {
    return t.religion === "christian" ? { category: "church", subtype: t.building ?? "church" } : { category: "other", subtype: `place_of_worship:${t.religion ?? "unknown"}` };
  }
  if (has("amenity", /^townhall$/) || (has("office", /^government$/) && /mairie|hôtel de ville|міська рада|міська державна адміністрація/i.test(t.name ?? ""))) return { category: "town_hall", subtype: "townhall" };
  if (has("historic", /^(castle|fort|manor|palace)$/)) return { category: "castle", subtype: t.historic };
  if (has("amenity", /^(school|college|university|kindergarten)$/)) return { category: "school", subtype: t.amenity };
  if (has("amenity", /^(hospital|clinic)$/)) return { category: "hospital", subtype: t.amenity };
  if (has("amenity", /^police$/)) return { category: "police", subtype: t.police ?? "police" };
  if (has("leisure", /^(park|garden)$/) || has("landuse", /^forest$/)) return { category: "park", subtype: t.leisure ?? t.landuse };
  if (has("landuse", /^cemetery$/) || has("amenity", /^grave_yard$/)) return { category: "cemetery", subtype: t.landuse ?? t.amenity };
  if (has("bridge") || has("man_made", /^bridge$/)) return { category: "bridge", subtype: "bridge" };
  if (has("amenity", /^fuel$/)) return { category: "fuel", subtype: "fuel" };
  if (has("amenity", /^pharmacy$/)) return { category: "pharmacy", subtype: "pharmacy" };
  if (has("tourism", /^(hotel|hostel|guest_house|motel)$/)) return { category: "hotel", subtype: t.tourism };
  if (has("natural", /^water$/) || has("waterway")) return { category: "water", subtype: t.waterway ?? t.water ?? "water" };
  if (has("building") && !["amenity", "tourism", "historic", "leisure", "place", "office", "shop"].some((k) => k in t)) {
    // A roof, a kiosk or a shed with a name ("Caisse") is not a place anyone reports from.
    if (/^(roof|service|kiosk|shed|hut|cabin|toilets|garages?|carport|container|transformer_tower)$/.test(t.building)) return null;
    return { category: "building", subtype: t.building };
  }
  const sub = t.amenity ?? t.tourism ?? t.historic ?? t.leisure ?? t.place ?? t.office ?? "other";
  return { category: "other", subtype: sub };
}

function namesOf(t: Record<string, string>): string[] {
  // "brand": a chain's name ("TotalEnergies", "Аптека Доброго Дня") is how people often say it.
  const keys = ["name", "name:uk", "name:fr", "name:en", "int_name", "alt_name", "short_name", "official_name", "old_name", "loc_name", "name:ru", "brand"];
  const out: string[] = [];
  const add = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  for (const k of keys) for (const v of (t[k] ?? "").split(";")) add(v);
  // Latin spelling of Ukrainian names, so "Khreshchatyk" matches when OSM has no name:en.
  const ukName = t["name:uk"] ?? t.name;
  if (ukName) add(transliterateUk(ukName));
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

// Busy public servers return 429/502/504; back off and alternate between the main server and a mirror.
// `accept` rejects an answer that parsed but is not usable; that counts as a failed attempt.
async function overpass(q: string, what: string, accept: (json: { elements: OsmEl[] }) => string | null = () => null): Promise<{ elements: OsmEl[] }> {
  const endpoints = [ENDPOINT, "https://overpass.private.coffee/api/interpreter"];
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = endpoints[attempt % endpoints.length];
    console.log(`Querying Overpass at ${url} for ${what} (attempt ${attempt + 1}) ...`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "edth-voice-to-map-gazetteer/0.1" },
        body: new URLSearchParams({ data: q }).toString(),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) {
        const json = (await res.json()) as { elements: OsmEl[] };
        const problem = accept(json);
        if (!problem) return json;
        console.log(`  unusable answer: ${problem}`);
      } else console.log(`  ${res.status}: ${(await res.text()).slice(0, 80).replace(/\s+/g, " ")}`);
    } catch (e) {
      console.log(`  ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt)));
  }
  throw new Error("Overpass unavailable after retries; existing data file left untouched");
}

/**
 * The town each point is in: the admin area at `level` (commune, city) that contains it.
 * One query; a marker element before each lookup tells the answers apart.
 */
async function townsOf(points: { lat: number; lon: number }[], level: number): Promise<(string | undefined)[]> {
  if (!points.length) return [];
  const q =
    "[out:json][timeout:120];\n" +
    points
      .map((p, i) => `make marker n="${i}"; out;\nis_in(${p.lat},${p.lon})->.a; area.a["boundary"="administrative"]["admin_level"="${level}"]; out tags;`)
      .join("\n");
  type El = OsmEl | { type: "marker"; tags: { n: string } };
  const read = (json: { elements: OsmEl[] }) => {
    const towns: (string | undefined)[] = points.map(() => undefined);
    let cur = -1;
    let markers = 0;
    for (const el of json.elements as El[]) {
      if (el.type === "marker") {
        cur = Number(el.tags.n);
        markers++;
      } else if (cur >= 0 && towns[cur] === undefined) towns[cur] = el.tags?.name;
    }
    return { towns, markers };
  };
  // Some mirrors answer without their area index: no markers, or no town at all. Try again elsewhere.
  const json = await overpass(q, `the towns of ${points.length} street groups`, (j) => {
    const { towns, markers } = read(j);
    if (markers !== points.length) return `${markers} of ${points.length} lookups answered`;
    return towns.some(Boolean) ? null : "no town found for any street";
  });
  const { towns } = read(json);
  const missing = towns.filter((t) => !t).length;
  if (missing) console.log(`  ${missing} street group(s) are in no admin_level=${level} area; they are told apart by distance`);
  return towns;
}

type Line = [number, number][];
type StreetPiece = { line: Line; osm_id: number; name: string; names: string[]; subtype: string };

/** The vertex nearest the middle of the pieces' box, so it always lies on the street. */
function onStreetCentre(lines: Line[]): { lat: number; lon: number; bbox: [number, number, number, number] } {
  const pts = lines.flat();
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
  return { lat: best[1], lon: best[0], bbox: [minLon, minLat, maxLon, maxLat] };
}

/** The area's box grown by `m` metres on every side. */
function areaBox(m: number): { s: number; w: number; n: number; e: number } {
  const dLat = m / 111_320;
  const dLon = m / (111_320 * Math.cos((((BBOX.s + BBOX.n) / 2) * Math.PI) / 180));
  return { s: BBOX.s - dLat, w: BBOX.w - dLon, n: BBOX.n + dLat, e: BBOX.e + dLon };
}
const inBox = (lat: number, lon: number, b: { s: number; w: number; n: number; e: number }) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;

/** The runs of a line that lie within 500 m of the area. */
function clipToArea(line: Line): Line[] {
  const box = areaBox(500);
  const runs: Line[] = [];
  let run: Line = [];
  for (const p of line) {
    if (inBox(p[1], p[0], box)) run.push(p);
    else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

async function main() {
  // GAZETTEER_RAW=<file> keeps Overpass's answer, so tuning the build does not query a busy server again.
  const raw = process.env.GAZETTEER_RAW;
  const json: { elements: OsmEl[] } = raw && existsSync(raw) ? JSON.parse(readFileSync(raw, "utf8")) : await overpass(query, `bbox ${bb}`);
  if (raw && !existsSync(raw)) writeFileSync(raw, JSON.stringify(json));
  console.log(`Overpass returned ${json.elements.length} elements`);

  const pois: (GazetteerFeature & { _prio: number })[] = [];
  const pieces = new Map<string, StreetPiece[]>();
  const riverPieces = new Map<string, StreetPiece[]>();
  let military = 0;

  for (const el of json.elements) {
    const t = el.tags ?? {};
    // A fuel station or a pharmacy often has only its chain's name.
    const name = t.name ?? (/^(fuel|pharmacy)$/.test(t.amenity ?? "") ? t.brand : undefined);
    if (!name) continue;
    const cat = categorize(t);
    if (!cat) continue;
    if (cat.category !== "street" && isMilitary(t)) {
      military++;
      continue;
    }

    // A river runs far beyond the area: keep only the stretches in or near it.
    if (cat.category === "water" && t.waterway) {
      // A stream in a culvert runs underground ("Хрещатик" under Khreshchatyk street): nobody is by it.
      if (!el.geometry?.length || t.tunnel) continue;
      const line = el.geometry.map((p) => [r5(p.lon), r5(p.lat)] as [number, number]);
      const key = normalize(name);
      for (const part of clipToArea(line)) riverPieces.set(key, [...(riverPieces.get(key) ?? []), { line: part, osm_id: el.id, name, names: namesOf(t), subtype: cat.subtype }]);
      continue;
    }

    if (cat.category === "street") {
      if (!el.geometry?.length) continue;
      const line = el.geometry.map((p) => [r5(p.lon), r5(p.lat)] as [number, number]);
      const key = normalize(t.name);
      pieces.set(key, [...(pieces.get(key) ?? []), { line, osm_id: el.id, name: t.name, names: namesOf(t), subtype: cat.subtype }]);
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
      name,
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

  if (military) console.log(`Left out ${military} military office(s) or site(s)`);

  // Streets: pieces of one name are one street when they are close, or close enough and in the
  // same town. Two towns' "rue Gambetta" stay two features, each with its town, so a report naming
  // one is asked back. Only names that split need the town lookup.
  const byName = [...pieces.entries()].map(([key, ps]) => ({
    key,
    groups: groupStreetPieces(ps.map((p) => p.line)).map((g) => g.map((i) => ps[i])),
  }));
  const split = byName.flatMap((n) => (n.groups.length > 1 ? n.groups : []));
  const towns = await townsOf(
    split.map((g) => onStreetCentre(g.map((p) => p.line))),
    AREA.townAdminLevel,
  );
  const townOf = new Map(split.map((g, i) => [g, towns[i]]));
  const streets: GazetteerFeature[] = [];
  for (const { key, groups } of byName) {
    const withTown = groups.map((g) => ({ pieces: g, lines: g.map((p) => p.line), town: townOf.get(g) }));
    const streetsOfName = joinSameTown(withTown).map((ix) => ({
      pieces: ix.flatMap((i) => withTown[i].pieces),
      town: withTown[ix[0]].town,
    }));
    const slug = (s: string) => normalize(s).replace(/ /g, "-");
    const suffixes = streetsOfName.map((s) => (s.town ? slug(s.town) : ""));
    streetsOfName.forEach((s, i) => {
      // The kind, name and id come from the first piece cars can use, so a street's kind does not
      // turn to "path" because a path of the same name runs beside it (Esplanade Saint-Louis).
      const first = s.pieces.find((p) => !/^(track|path|bridleway)$/.test(p.subtype)) ?? s.pieces[0];
      const lines = s.pieces.map((p) => p.line);
      const names: string[] = [];
      for (const p of s.pieces) for (const n of p.names) if (!names.includes(n)) names.push(n);
      // One street keeps the plain id; same-name streets get their town, or a number when that does not tell them apart.
      const unique = suffixes[i] && suffixes.filter((x) => x === suffixes[i]).length === 1;
      const id = streetsOfName.length === 1 ? `street/${slug(key)}` : `street/${slug(key)}/${unique ? suffixes[i] : `${suffixes[i] || "part"}-${i + 1}`}`;
      streets.push({
        id,
        name: first.name,
        names,
        category: "street",
        subtype: first.subtype,
        ...onStreetCentre(lines),
        ...(streetsOfName.length > 1 && s.town ? { town: s.town } : {}),
        osm_type: "way",
        osm_id: first.osm_id,
        lines,
      });
    });
  }
  const sharedNames = streets.filter((s) => s.id.split("/").length > 2);
  console.log(`Streets: ${streets.length} from ${pieces.size} names; ${sharedNames.length} share a name with another street:`);
  for (const s of sharedNames) console.log(`  ${s.id}  ${s.town ?? "(no town)"}  ${s.lat},${s.lon}  ${s.lines!.length} piece(s)`);

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

  // Rivers: pieces of one name joined like streets. Each stretch is a line, so a report is placed
  // on the bank nearest the speaker, not at the middle of the river.
  const rivers: GazetteerFeature[] = [];
  for (const [key, ps] of riverPieces) {
    const groups = groupStreetPieces(ps.map((p) => p.line)).map((g) => g.map((i) => ps[i]));
    groups.forEach((g, i) => {
      const names: string[] = [];
      for (const p of g) for (const n of p.names) if (!names.includes(n)) names.push(n);
      const lines = g.map((p) => p.line);
      rivers.push({
        id: `water/${key.replace(/ /g, "-")}${groups.length > 1 ? `/part-${i + 1}` : ""}`,
        name: g[0].name,
        names,
        category: "water",
        subtype: g[0].subtype,
        ...onStreetCentre(lines),
        osm_type: "way",
        osm_id: g[0].osm_id,
        lines,
      });
    });
  }
  const riverNames = new Set(rivers.map((r) => normalize(r.name)));

  // A big feature that only touches the area (a river's whole bank, a medieval trade route, a
  // university spread over the city) has its middle far away. Leave out what lies more than 1 km out.
  const near = areaBox(1000);
  const dropped: string[] = [];
  const kept = merged.filter((p) => {
    // The river's line already stands for its water area.
    const drop = !inBox(p.lat, p.lon, near) || (p.category === "water" && riverNames.has(normalize(p.name)));
    if (drop) dropped.push(`${p.id} ${p.name} [${p.category}] ${p.lat},${p.lon}`);
    return !drop;
  });
  if (dropped.length) console.log(`Left out ${dropped.length} far or duplicate feature(s):\n  ${dropped.join("\n  ")}`);

  // A stop or a building named after a place next to it ("Bérault-Métro" bus stop, "Хрещатик" stop
  // on Khreshchatyk) adds nothing but a question. Leave it out when that place is within 400 m.
  // Names are compared without their type words: "Vincennes RER" is the station "Vincennes".
  const landmarks = [...kept.filter((p) => p.category !== "stop" && p.category !== "building"), ...streets, ...rivers];
  const keysOf = (f: GazetteerFeature) => {
    const out = new Set<string>();
    for (const n of f.names.length ? f.names : [f.name]) {
      const toks = canonTokens(n);
      out.add(toks.join(" "));
      out.add(toks.filter((t) => !categoryOfToken(t)).join(" "));
    }
    out.delete("");
    return out;
  };
  const landmarkKeys = landmarks.map((f) => ({ f, keys: keysOf(f) }));
  let echoes = 0;
  const pointsOfInterest = kept.filter((p) => {
    if (p.category !== "stop" && p.category !== "building") return true;
    const keys = keysOf(p);
    const echo = landmarkKeys.some(({ f, keys: k }) => {
      if (![...keys].some((x) => k.has(x))) return false;
      const at = f.lines?.length ? nearestPointOnLines(p, f.lines) : f;
      return haversine(p.lat, p.lon, at.lat, at.lon) <= 400;
    });
    if (echo) echoes++;
    return !echo;
  });
  console.log(`Left out ${echoes} stop(s) and building(s) named after a place within 400 m`);

  const features: GazetteerFeature[] = [
    ...pointsOfInterest.map(({ _prio, ...f }) => {
      void _prio;
      return f;
    }),
    ...streets,
    ...rivers,
  ];
  features.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  mkdirSync("data", { recursive: true });
  const out = {
    source: "OpenStreetMap via Overpass API (© OpenStreetMap contributors, ODbL)",
    built_at: new Date().toISOString(),
    area: AREA.id,
    bbox: BBOX,
    count: features.length,
    features,
  };
  writeFileSync(OUT_FILE, JSON.stringify(out));

  const counts: Record<string, number> = {};
  for (const f of features) counts[f.category] = (counts[f.category] ?? 0) + 1;
  console.log(`Wrote ${features.length} features to ${OUT_FILE}`, counts);
  for (const c of ["metro_station", "church", "castle", "town_hall", "cemetery"]) {
    console.log(`\n${c}:`);
    for (const f of features.filter((x) => x.category === c)) console.log(`  ${f.id}  ${f.name}  [${f.subtype}]  ${f.lat},${f.lon}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
