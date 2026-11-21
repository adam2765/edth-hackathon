/**
 * Deterministic resolver: intent + last position + gazetteer → pin, or a question.
 * Pure function. The language model never produces coordinates; every coordinate here
 * comes from the gazetteer, from geometry applied to a gazetteer feature, or from the last
 * position moved by a distance and compass direction the speaker stated.
 */
import type { Candidate, Category, Direction, GazetteerFeature, Intent, LastPosition, Placement, Relation, Resolution } from "./types";
import { bboxHalfDiagonalM, bboxHalfExtentM, bearingDeg, destination, distanceM, nearestPointOnLines, type LatLon } from "./geo";
import { canonTokens, categoryIsExplicit, genericCategoryOf, isCategoryWord, metroIsExplicit, searchByName, stripCategoryWords, type NameMatch } from "./gazetteer";
import { angleBetween, crossingName, crossingsOf, crossStreets, streetAxisAt, type Crossing } from "./crossings";

export const FRESH_MS = 10 * 60 * 1000;
export const CATEGORY_RADIUS_M = 1500;
export const NEAREST_RATIO = 0.4;
/** A name match must score at least this... */
export const GOOD_SCORE = 0.7;
/** ...and be within this of the best match to count as a contender. */
export const SCORE_MARGIN = 0.1;
export const MAX_CHOICES = 3;
/** Same-name matches this close together are one place for our purposes; no question is worth asking. */
export const COLOCATED_M = 120;
/** ...unless one of them is bigger than this: a 1.2 km street and the station on it are worth a question. */
export const COLOCATED_MAX_EXTENT_M = 300;

const REL_RADIUS: Record<Relation, number> = {
  at: 30,
  near: 80,
  behind: 80,
  in_front_of: 80,
  next_to: 80,
  between: 150,
  north_of: 100,
  south_of: 100,
  east_of: 100,
  west_of: 100,
  north_east_of: 100,
  south_east_of: 100,
  south_west_of: 100,
  north_west_of: 100,
  towards: 0,
};
const COMPASS: Partial<Record<Relation, number>> = {
  north_of: 0,
  north_east_of: 45,
  east_of: 90,
  south_east_of: 135,
  south_of: 180,
  south_west_of: 225,
  west_of: 270,
  north_west_of: 315,
};
const DIRECTION_DEG: Record<Direction, number> = { north: 0, north_east: 45, east: 90, south_east: 135, south: 180, south_west: 225, west: 270, north_west: 315 };
const COMPASS_OFFSET_M = 100;
const MAX_EXTENT_RADIUS_M = 500;
/** Smallest circle for a position estimated from a movement report. */
const MOVE_MIN_RADIUS_M = 50;
/**
 * A compass word is one of eight, so "north" is anything within 22.5° of north: up to 0.38 of the
 * distance sideways. The circle for "d metres north" is this share of d.
 */
export const COMPASS_SPREAD = 0.4;
/** A distance said aloud is paced or judged by eye; it is taken as good to a quarter. */
export const DISTANCE_SLACK = 0.25;

/** A crossing this close to the last position is the one the speaker is at, not the next one. */
export const AT_CROSSING_M = 20;
/** "The next crossing" is looked for this far along the street, or around the speaker. */
export const NEXT_CROSSING_REACH_M = 500;
/** The speaker counts as on their street while their last position is this close to it. */
export const ON_STREET_M = 60;
/** A crossing is ahead when it lies within this angle of the way the speaker is going. */
export const AHEAD_DEG = 60;
/** The way the speaker moved counts only when it runs along their street, within this angle. */
export const ALONG_STREET_DEG = 45;

/** Words that pick out which crossing, not a street: "the next crossing", "le prochain carrefour", "наступне перехрестя". */
function isPointerWord(t: string): boolean {
  return (
    ["next", "nearest", "first", "this", "that", "upcoming", "prochain", "prochaine", "premier", "premiere", "suivant", "suivante", "ce", "cet", "cette"].includes(t) ||
    /^(наступн|найближч|ближч|перш|цьом|цей|це|следующ|ближайш)/.test(t)
  );
}

/** Was a crossing word said? */
function saysCrossing(text: string): boolean {
  return canonTokens(text).some((t) => isCategoryWord(t, "intersection"));
}

/** A name with the crossing and pointer words taken out: "the corner of rue de Fontenay" → "rue fontenay"; null when nothing is left. */
function crossingCore(name: string): string | null {
  const core = canonTokens(name).filter((t) => !isCategoryWord(t, "intersection") && !isPointerWord(t));
  return core.length ? core.join(" ") : null;
}

/** "Which crossing on Avenue de Nogent: Villa d'Idalie, or Route des Pelouses Marigny?" */
function crossingQuestion(labels: string[], onStreet: string | null, lang: Lang): string {
  const list = joinOr(labels, lang);
  if (lang === "fr") return onStreet ? `Quel carrefour sur ${onStreet} : ${list} ?` : `Quel carrefour : ${list} ?`;
  if (lang === "uk") return onStreet ? `Яке перехрестя на ${onStreet}: ${list}?` : `Яке перехрестя: ${list}?`;
  return onStreet ? `Which crossing on ${onStreet}: ${list}?` : `Which crossing: ${list}?`;
}

/** Circle for a point a stated distance away on a compass bearing. */
const compassRadius = (d: number) => Math.max(MOVE_MIN_RADIUS_M, Math.round(COMPASS_SPREAD * d));
/** How unsure the last position itself is: a position worked out from it starts with that much. */
const startRadius = (last: LastPosition) => Math.round(last.radius_m ?? last.uncertainty_m ?? 0);

export interface ResolveInput {
  intent: Intent;
  transcript: string;
  lastPosition?: LastPosition | null;
  /** epoch ms; injected so the function stays pure */
  now: number;
  gazetteer: GazetteerFeature[];
  /** Reference point when there is no last position. Defaults to the centre of Vincennes. */
  areaCentre?: LatLon;
}

type Lang = "en" | "fr" | "uk";
const DEFAULT_CENTRE: LatLon = { lat: 48.8455, lon: 2.435 };

/** The parts of a report that place the speaker once the landmark is known. */
type Said = Pick<Intent, "relation" | "kind" | "distance_m" | "direction">;

/** Where the speaker is if `f` is the landmark they meant. */
export function placementFor(f: GazetteerFeature, said: Said, last: LastPosition | null | undefined): Placement {
  const rel: Relation = said.relation ?? (said.kind === "movement" ? "towards" : "near");
  const d = said.distance_m ?? null;
  const travel = said.direction ? DIRECTION_DEG[said.direction] : null;

  // "Moved 300 m north on rue X": the distance and direction place the point from the last
  // position, and the street says which line it is on. The circle still reaches the unsnapped point.
  if (said.kind === "movement" && last && d != null && travel != null && f.lines?.length && said.relation !== "towards" && COMPASS[rel] === undefined) {
    const reckoned = destination(last, travel, d);
    const pin = nearestPointOnLines(reckoned, f.lines);
    return { pin, radius_m: Math.max(startRadius(last) + compassRadius(d), Math.round(distanceM(reckoned, pin))), estimated: true };
  }

  // "Moving down Avenue X": a move with a street and no "towards" is a move along it, so the speaker
  // is on the street, not on the way to it. Where along it is not said: the point nearest the last
  // position, with a circle that takes in the last position's own, the step onto the street and any
  // distance said. With no last position, anywhere on the street, as for "I'm on Avenue X".
  if (said.kind === "movement" && said.relation == null && f.lines?.length) {
    if (!last) return placementFor(f, { ...said, kind: "position", relation: "at", distance_m: null }, last);
    const pin = nearestPointOnLines(last, f.lines);
    const reach = startRadius(last) + Math.round(distanceM(last, pin)) + (d != null ? Math.round(d * (1 + DISTANCE_SLACK)) : 0);
    return { pin, radius_m: Math.max(MOVE_MIN_RADIUS_M, reach), estimated: true };
  }

  // The landmark's reference point: for a street, the point on it nearest the speaker's last position.
  const anchor: LatLon = f.lines?.length && last ? nearestPointOnLines(last, f.lines) : { lat: f.lat, lon: f.lon };

  if (rel === "towards") {
    const heading_to = { lat: anchor.lat, lon: anchor.lon, id: f.id, name: f.name };
    // With no starting point there is nothing to move: the client shows only the target.
    if (!last) return { heading_to };
    const leg = distanceM(last, anchor);
    const along = (m: number) => (leg < 1 ? { lat: last.lat, lon: last.lon } : destination(last, bearingDeg(last, anchor), m));
    // "Moved 200 m towards X": that far along the leg, and not past X.
    if (d != null) {
      return { pin: along(Math.min(d, leg)), radius_m: startRadius(last) + Math.max(MOVE_MIN_RADIUS_M, Math.round(DISTANCE_SLACK * d)), heading_to, estimated: true };
    }
    // "I moved towards X" gives a direction, not a distance. The marker moves to the middle of the
    // leg and the circle spans all of it, from where they were to X: that is what we actually know.
    return { pin: along(leg / 2), radius_m: Math.max(MOVE_MIN_RADIUS_M, Math.round(leg / 2)), heading_to, estimated: true };
  }

  // Size of the feature itself is uncertainty too: "at the park" is anywhere in the park.
  // A street or a river is a line: the anchor is already the nearest point on it.
  const line = f.category === "street" || !!f.lines?.length;
  let extent = 0;
  if (line) extent = last ? 40 : f.bbox ? Math.min(400, bboxHalfDiagonalM(f.bbox)) : 150;
  else if (f.bbox) extent = Math.min(MAX_EXTENT_RADIUS_M, bboxHalfDiagonalM(f.bbox));

  const bearing = COMPASS[rel];
  if (bearing !== undefined) {
    const edge = f.bbox && !line ? Math.min(MAX_EXTENT_RADIUS_M, bboxHalfExtentM(f.bbox, bearing)) : 0;
    // With a distance said, the pin is that far out and the circle grows with it; without one, about 100 m out.
    return d != null
      ? { pin: destination(anchor, bearing, edge + d), radius_m: compassRadius(d) }
      : { pin: destination(anchor, bearing, edge + COMPASS_OFFSET_M), radius_m: REL_RADIUS[rel] };
  }

  // "200 metres from the church": the distance is known, the side is not, so the circle takes in
  // the whole ring. A direction of travel in the same report means the distance was how far they
  // moved, not how far they are from this place.
  const reach = d != null && travel == null ? extent + d * (1 + DISTANCE_SLACK) : extent;
  return { pin: { lat: anchor.lat, lon: anchor.lon }, radius_m: Math.round(Math.max(REL_RADIUS[rel], reach)) };
}

function toCandidate(f: GazetteerFeature, ref: LatLon, intent: Intent, last: LastPosition | null | undefined, score?: number): Candidate {
  return {
    id: f.id,
    name: f.name,
    category: f.category,
    subtype: f.subtype,
    lat: f.lat,
    lon: f.lon,
    distance_m: Math.round(distanceM(ref, f.lines?.length ? nearestPointOnLines(ref, f.lines) : f)),
    ...(f.town ? { town: f.town } : {}),
    score,
    placement: placementFor(f, intent, last),
  };
}

const CAT_LABEL: Record<Category, Record<Lang, string> & { frWhich: string; ukWhich: string }> = {
  church: { en: "church", fr: "église", uk: "церква", frWhich: "Quelle église", ukWhich: "Яка церква" },
  metro_station: { en: "station", fr: "station", uk: "станція", frWhich: "Quelle station", ukWhich: "Яка станція" },
  castle: { en: "castle", fr: "château", uk: "замок", frWhich: "Quel château", ukWhich: "Який замок" },
  town_hall: { en: "town hall", fr: "mairie", uk: "адміністрація", frWhich: "Quelle mairie", ukWhich: "Яка адміністрація" },
  school: { en: "school", fr: "école", uk: "школа", frWhich: "Quelle école", ukWhich: "Яка школа" },
  park: { en: "park", fr: "parc", uk: "парк", frWhich: "Quel parc", ukWhich: "Який парк" },
  cemetery: { en: "cemetery", fr: "cimetière", uk: "кладовище", frWhich: "Quel cimetière", ukWhich: "Яке кладовище" },
  hospital: { en: "hospital", fr: "hôpital", uk: "лікарня", frWhich: "Quel hôpital", ukWhich: "Яка лікарня" },
  police: { en: "police station", fr: "commissariat", uk: "поліція", frWhich: "Quel commissariat", ukWhich: "Який відділок поліції" },
  bridge: { en: "bridge", fr: "pont", uk: "міст", frWhich: "Quel pont", ukWhich: "Який міст" },
  street: { en: "street", fr: "rue", uk: "вулиця", frWhich: "Quelle rue", ukWhich: "Яка вулиця" },
  stop: { en: "stop", fr: "arrêt", uk: "зупинка", frWhich: "Quel arrêt", ukWhich: "Яка зупинка" },
  fuel: { en: "fuel station", fr: "station-service", uk: "заправка", frWhich: "Quelle station-service", ukWhich: "Яка заправка" },
  pharmacy: { en: "pharmacy", fr: "pharmacie", uk: "аптека", frWhich: "Quelle pharmacie", ukWhich: "Яка аптека" },
  hotel: { en: "hotel", fr: "hôtel", uk: "готель", frWhich: "Quel hôtel", ukWhich: "Який готель" },
  water: { en: "river or lake", fr: "plan d'eau", uk: "водойма", frWhich: "Quel plan d'eau", ukWhich: "Яка водойма" },
  building: { en: "building", fr: "bâtiment", uk: "будівля", frWhich: "Quel bâtiment", ukWhich: "Яка будівля" },
  intersection: { en: "crossing", fr: "carrefour", uk: "перехрестя", frWhich: "Quel carrefour", ukWhich: "Яке перехрестя" },
  other: { en: "place", fr: "lieu", uk: "місце", frWhich: "Quel lieu", ukWhich: "Яке місце" },
};

/** Kinds of "other" places worth naming in a question. */
const SUBTYPE_LABEL: Record<string, Record<Lang, string>> = {
  theatre: { en: "theatre", fr: "théâtre", uk: "театр" },
  cinema: { en: "cinema", fr: "cinéma", uk: "кінотеатр" },
  museum: { en: "museum", fr: "musée", uk: "музей" },
  gallery: { en: "gallery", fr: "galerie", uk: "галерея" },
  artwork: { en: "artwork", fr: "œuvre", uk: "скульптура" },
  monument: { en: "monument", fr: "monument", uk: "пам'ятник" },
  memorial: { en: "memorial", fr: "mémorial", uk: "меморіал" },
  attraction: { en: "landmark", fr: "site", uk: "пам'ятка" },
  square: { en: "square", fr: "place", uk: "площа" },
  library: { en: "library", fr: "bibliothèque", uk: "бібліотека" },
  post_office: { en: "post office", fr: "poste", uk: "пошта" },
  marketplace: { en: "market", fr: "marché", uk: "ринок" },
  stadium: { en: "stadium", fr: "stade", uk: "стадіон" },
};

/**
 * Choice labels. When two choices share a name, say what tells them apart: the kind of place
 * ("Château de Vincennes (castle)"), or for two places of one kind the town ("Rue Gambetta
 * (Montreuil)"), or failing that the distance ("Rue Gambetta (2.1 km)").
 */
export function choiceLabels(cands: Candidate[], lang: Lang): string[] {
  const kind = (c: Candidate) => (c.category === "other" && c.subtype && SUBTYPE_LABEL[c.subtype]?.[lang]) || CAT_LABEL[c.category][lang];
  const name = (c: Candidate) => c.name.toLowerCase();
  const twin = (a: Candidate, b: Candidate) => a.category === b.category && name(a) === name(b);
  const far = (m: number) => (m < 1000 ? `${m} ${lang === "uk" ? "м" : "m"}` : `${(m / 1000).toFixed(1).replace(".", lang === "en" ? "." : ",")} ${lang === "uk" ? "км" : "km"}`);
  return cands.map((c) => {
    // Also when another choice of another kind contains this name: "Хрещатик (станція)" next to
    // "вулиця Хрещатик". Of the same kind, the kind tells them no further apart.
    const kindClash = cands.some((o) => o !== c && !twin(o, c) && o.category !== c.category && name(o).includes(name(c)));
    const twins = cands.filter((o) => o !== c && twin(o, c));
    const where = !twins.length ? null : c.town && twins.every((o) => o.town && o.town !== c.town) ? c.town : far(c.distance_m);
    const parts = [kindClash ? kind(c) : null, where].filter(Boolean);
    return parts.length ? `${c.name} (${parts.join(", ")})` : c.name;
  });
}

function joinOr(items: string[], lang: Lang): string {
  if (items.length <= 1) return items.join("");
  const or = lang === "fr" ? " ou " : lang === "uk" ? " чи " : ", or ";
  return items.slice(0, -1).join(", ") + or + items[items.length - 1];
}

function askQuestion(cands: Candidate[], lang: Lang, category: Category | null, notFound?: string): string {
  const labels = joinOr(choiceLabels(cands, lang), lang);
  const cat = category ? CAT_LABEL[category] : null;
  if (lang === "fr") {
    const lead = notFound ? `Je ne trouve pas « ${notFound} ». ` : "";
    if (cands.length === 1) return `${lead}Vous voulez dire ${labels} ?`;
    return `${lead}${cat ? cat.frWhich : "Lequel"} : ${labels} ?`;
  }
  if (lang === "uk") {
    const lead = notFound ? `Не знаходжу «${notFound}». ` : "";
    if (cands.length === 1) return `${lead}Ви маєте на увазі ${labels}?`;
    return `${lead}${cat ? cat.ukWhich : "Уточніть"}: ${labels}?`;
  }
  const lead = notFound ? `I can't find "${notFound}". ` : "";
  if (cands.length === 1) return `${lead}Do you mean ${labels}?`;
  return `${lead}Which ${cat ? cat.en : "one"}: ${labels}?`;
}

/**
 * `no_start`: a move with nowhere to start from. `incomplete`: a move with its distance or its
 * direction missing. `crossing_no_start`: "the next crossing" with no idea where the speaker is.
 */
type Prompt = "place" | "no_start" | "incomplete" | "crossing_no_start";

function unresolvedPrompt(lang: Lang, prompt: Prompt = "place"): string {
  if (prompt === "crossing_no_start") {
    if (lang === "fr") return "Je ne sais pas où vous êtes. Donnez les noms des rues qui se croisent.";
    if (lang === "uk") return "Не знаю, де ви. Назвіть вулиці, що там перетинаються.";
    return "I don't know where you are. Name the streets that cross there.";
  }
  if (prompt === "no_start") {
    if (lang === "fr") return "Je ne sais pas d'où vous partez. Donnez le nom d'une rue ou d'un lieu.";
    if (lang === "uk") return "Не знаю, звідки ви вирушили. Назвіть вулицю або орієнтир.";
    return "I don't know where you started. Name a street or a landmark.";
  }
  if (prompt === "incomplete") {
    if (lang === "fr") return "Il me faut une distance et une direction, ou un lieu.";
    if (lang === "uk") return "Потрібні відстань і напрямок або орієнтир.";
    return "I need a distance and a compass direction, or a landmark.";
  }
  if (lang === "fr") return "Je n'ai pas pu vous placer. Donnez le nom d'une rue ou d'un lieu.";
  if (lang === "uk") return "Не вдалося визначити місце. Назвіть вулицю або орієнтир.";
  return "I couldn't place that. Name a street or a landmark.";
}

export function resolve(input: ResolveInput): Resolution {
  const { intent, transcript, lastPosition: last, now, gazetteer } = input;
  const lang: Lang = intent.language === "fr" || intent.language === "uk" ? intent.language : "en";
  const d = intent.distance_m ?? null;
  const plain = (rule: string, detail: string, prompt?: Prompt): Resolution => ({
    status: "unresolved",
    candidates: [],
    question: unresolvedPrompt(lang, prompt),
    evidence: { rule, detail },
  });

  // Dead reckoning: no place to go by, only "d metres on this bearing" from the last position.
  // The circle is the last position's own circle plus the spread of the move, so it grows with each leg.
  const reckon = (from: LastPosition, bearing: number, dist: number, why: string): Resolution => {
    const start = startRadius(from);
    const age = Math.max(0, Math.round((now - from.ts) / 60_000));
    return {
      status: "resolved",
      pin: destination(from, bearing, dist),
      radius_m: start + compassRadius(dist),
      estimated: true,
      candidates: [],
      evidence: {
        rule: "dead_reckoned",
        detail: `${why}; ${dist} m on bearing ${bearing}° from the last position (${age} min old); circle ${start} m at the start + ${compassRadius(dist)} m for the move`,
      },
    };
  };

  // A place that cannot be found does not stop a move that states its own distance and direction.
  const unresolved = (rule: string, detail: string): Resolution =>
    last && d != null && intent.direction ? reckon(last, DIRECTION_DEG[intent.direction], d, `${rule} (${detail}), so placed from the stated move`) : plain(rule, detail);

  let name = intent.landmark_name?.trim() || null;
  // Dictionary form of an inflected name ("мостом Патона" → "міст Патона"); same as the name in English and French.
  let lemma = intent.landmark_name_lemma?.trim() || null;
  if (!name) [name, lemma] = [lemma, null];
  let category = intent.landmark_category;

  // "the church", "la mairie", "церкви": a category word said as if it were a name. Unless a
  // place is called exactly that: "Hôtel du Château" is a hotel, not "the hotel" or "the castle".
  // One word is always generic: a pharmacy called just "Pharmacie" must not win "la pharmacie".
  if (name) {
    const generic = genericCategoryOf(lemma ?? name) ?? genericCategoryOf(name);
    const named = (q: string | null) => !!q && canonTokens(q).length > 1 && searchByName(q, gazetteer).some((m) => m.exact);
    if (generic !== undefined && !named(lemma) && !named(name)) {
      name = null;
      // The model sometimes files the word under "other" ("Heading towards the cemetery", 20 Nov).
      if (!category || (category === "other" && generic)) category = generic;
    }
  }
  // A crossing only when one was said: the model has called a square one ("Я на Майдані
  // Незалежності" came back as "intersection"). Without a crossing word, the name is searched as usual.
  if (category === "intersection" && !saysCrossing(transcript)) category = null;
  // "Passing the next intersection" read as no place at all: the crossing word is in what was said.
  if (!name && (!category || category === "street" || category === "other") && d == null && !intent.direction && saysCrossing(transcript)) {
    category = "intersection";
  }
  // A crossing word inside the name: "Carrefour des Rigollots" is a place of its own; "the next
  // crossing" and "the corner of rue de Fontenay" are not, so only the street name is kept.
  if (category === "intersection" && name && saysCrossing(name)) {
    const best = searchByName([...new Set([lemma, name].filter((q): q is string => !!q))], gazetteer)[0];
    if (best && best.score >= GOOD_SCORE && saysCrossing(best.feature.name)) category = null;
    else {
      name = crossingCore(name);
      lemma = null;
    }
  }
  if (!name && !category) {
    // "300 metres north of my last position" says the same as "moved 300 metres north".
    const bearing = intent.direction ? DIRECTION_DEG[intent.direction] : intent.relation ? COMPASS[intent.relation] : undefined;
    if (bearing === undefined && d == null) {
      return intent.kind === "other"
        ? plain("no_position_in_report", "the report did not state a position or movement")
        : plain("no_landmark", "no landmark name or category in the report");
    }
    if (bearing === undefined || d == null) {
      return plain("move_incomplete", `no place named, and ${d == null ? "a direction with no distance" : "a distance with no compass direction"}`, "incomplete");
    }
    if (!last) return plain("dead_reckoning_no_start", `${d} m on bearing ${bearing}° but no last position to start from`, "no_start");
    return reckon(last, bearing, d, "no place named");
  }
  if (intent.kind === "other" && category !== "intersection") return plain("no_position_in_report", "the report did not state a position or movement");

  const ref: LatLon = last ?? input.areaCentre ?? DEFAULT_CENTRE;
  const fresh = !!last && now - last.ts < FRESH_MS;
  const refLabel = last ? (fresh ? "last position" : "stale last position") : "area centre";

  const decide = (cands: Candidate[], prefix: string, extra: string, forceAsk = false, notFound?: string): Resolution => {
    cands.sort((a, b) => a.distance_m - b.distance_m);
    if (!cands.length) return unresolved(`${prefix}_none`, extra);
    if (!forceAsk && cands.length === 1) {
      return resolvedFrom(cands[0], cands, `${prefix}_unique`, `${extra}; one candidate`);
    }
    // A last position estimated from a movement report is only known to ±u metres, so the nearest
    // candidate has to win even in the worst case: it u farther away, the second u closer.
    const u = last?.uncertainty_m ?? 0;
    if (!forceAsk && fresh && cands[0].distance_m + u < NEAREST_RATIO * Math.max(0, cands[1].distance_m - u)) {
      return resolvedFrom(
        cands[0],
        cands.slice(0, MAX_CHOICES),
        `${prefix}_nearest_wins`,
        `${extra}; nearest ${cands[0].distance_m} m < ${NEAREST_RATIO} × second ${cands[1].distance_m} m from fresh last position${u ? `, allowing ±${Math.round(u)} m on that estimate` : ""}`,
      );
    }
    const top = cands.slice(0, MAX_CHOICES);
    const why = forceAsk
      ? "name not in gazetteer, asking among category"
      : !fresh && cands.length > 1
        ? `${cands.length} candidates and no fresh last position`
        : `${cands.length} candidates, nearest ${cands[0].distance_m} m not < ${NEAREST_RATIO} × second ${cands[1].distance_m} m`;
    return {
      status: "ambiguous",
      candidates: top,
      question: askQuestion(top, lang, prefix === "category" || forceAsk ? category : sameCategory(top), notFound),
      evidence: { rule: `${prefix}_ambiguous`, detail: `${extra}; ${why}` },
    };
  };

  // A crossing: worked out from where the street lines meet, never from the model.
  if (category === "intersection") {
    const crossings = crossingsOf(gazetteer);
    const street = last?.street ? gazetteer.find((f) => f.id === last.street && f.category === "street" && f.lines?.length) : undefined;
    // On the street only while near it: "moving towards Avenue X" from 600 m away is not on it yet.
    const onStreet = street && last && distanceM(last, nearestPointOnLines(last, street.lines!)) <= ON_STREET_M ? street : undefined;
    // Measured from the point on the street nearest the last position: an estimate can sit beside the street.
    const from: LatLon = last ? (onStreet ? nearestPointOnLines(last, onStreet.lines!) : last) : ref;
    const rel: Relation = intent.relation ?? "at";
    const said: Said = { relation: rel, kind: rel === "towards" ? "movement" : "position", distance_m: COMPASS[rel] !== undefined ? d : null, direction: null };
    const toCand = (c: Crossing): Candidate => {
      const label = crossingName(c, onStreet?.id);
      const f: GazetteerFeature = { id: c.id, name: label, names: [label], category: "intersection", lat: c.lat, lon: c.lon, osm_type: "node", osm_id: 0 };
      return { id: c.id, name: label, category: "intersection", lat: c.lat, lon: c.lon, distance_m: Math.round(distanceM(from, c)), streets: c.streets, placement: placementFor(f, said, last) };
    };

    // "At the corner of rue de Fontenay": the crossings of that street, with the speaker's own street if it has one.
    if (name) {
      const queries = [...new Set([lemma, name].filter((q): q is string => !!q))];
      const found = searchByName(queries, gazetteer).filter((m) => m.feature.category === "street");
      const best = found[0]?.score ?? 0;
      const named = new Set(found.filter((m) => m.score >= GOOD_SCORE && m.score >= best - SCORE_MARGIN).map((m) => m.feature.id));
      if (!named.size) return unresolved("crossing_street_none", `no street called "${lemma ?? name}" above ${GOOD_SCORE}`);
      let pool = crossings.filter((c) => c.streets.some((s) => named.has(s)));
      let note = `${named.size} street(s) called "${lemma ?? name}"`;
      if (onStreet) {
        const both = pool.filter((c) => c.streets.includes(onStreet.id));
        if (both.length) {
          pool = both;
          note += ` crossing ${onStreet.name}`;
        }
      }
      const cands = pool.map(toCand).filter((c) => c.distance_m <= CATEGORY_RADIUS_M);
      return decide(cands, "crossing", `${note}; ${cands.length} crossing(s) within ${CATEGORY_RADIUS_M} m of ${refLabel}`);
    }

    // "Passing the next crossing": the nearest one along the speaker's street, or around them.
    if (!last) return plain("crossing_no_start", "a crossing with no street named and no last position", "crossing_no_start");
    const where = onStreet ? `on ${onStreet.name}` : "around the last position";
    const near = crossings
      .filter((c) => !onStreet || c.streets.includes(onStreet.id))
      .map((c) => ({ c, dist: distanceM(from, c), bearing: bearingDeg(from, c) }))
      .filter((x) => x.dist > AT_CROSSING_M && x.dist <= NEXT_CROSSING_REACH_M)
      .sort((a, b) => a.dist - b.dist);
    if (!near.length) return unresolved("crossing_none", `no crossing ${where} within ${NEXT_CROSSING_REACH_M} m`);

    // Which way the speaker is going: a compass direction said in this report, or else the way they
    // moved between their last two fixes, when that was recent and runs along their street.
    let heading: number | null = null;
    let why = "";
    if (intent.direction) {
      heading = DIRECTION_DEG[intent.direction];
      why = `going ${intent.direction.replace("_", "-")}, as said`;
    } else if (onStreet && fresh && last.heading_deg != null) {
      const axis = streetAxisAt(from, onStreet.lines!);
      if (axis != null && Math.min(angleBetween(last.heading_deg, axis), angleBetween(last.heading_deg, axis + 180)) <= ALONG_STREET_DEG) {
        heading = last.heading_deg;
        why = `going on the way it moved from its previous fix (${Math.round(heading)}°)`;
      }
    }
    if (heading != null) {
      const ahead = near.find((x) => angleBetween(x.bearing, heading) <= AHEAD_DEG);
      if (ahead) {
        const c = toCand(ahead.c);
        return resolvedFrom(c, [c], "crossing_next_ahead", `${near.length} crossing(s) ${where} within ${NEXT_CROSSING_REACH_M} m; ${why}; nearest ahead ${c.distance_m} m`);
      }
    }

    // Not known which way: one each way along the street, or the nearest few in different directions.
    const picks: typeof near = [];
    for (const x of near) {
      if (picks.length >= (onStreet ? 2 : MAX_CHOICES)) break;
      if (picks.every((p) => angleBetween(p.bearing, x.bearing) > (onStreet ? 90 : 45))) picks.push(x);
    }
    const cands = picks.map((x) => toCand(x.c));
    if (cands.length === 1) {
      return resolvedFrom(cands[0], cands, "crossing_next_one_way", `${near.length} crossing(s) ${where} within ${NEXT_CROSSING_REACH_M} m, all one way; nearest ${cands[0].distance_m} m`);
    }
    // On a known street the choices are the streets that cross it.
    const short = onStreet ? picks.map((x) => crossStreets(x.c, onStreet.id)) : [];
    const labels = short.length && short.every(Boolean) && new Set(short).size === short.length ? short : choiceLabels(cands, lang);
    return {
      status: "ambiguous",
      candidates: cands,
      question: crossingQuestion(labels, short === labels ? onStreet!.name : null, lang),
      evidence: {
        rule: "crossing_next_ambiguous",
        detail: `${near.length} crossing(s) ${where} within ${NEXT_CROSSING_REACH_M} m; ${heading == null ? "which way is not known" : "none ahead"}, so ${onStreet ? "one each way" : "the nearest in different directions"}`,
      },
    };
  }

  if (name) {
    const queries = [...new Set([lemma, name].filter((q): q is string => !!q))];
    let all = searchByName(queries, gazetteer);
    let saidForExplicit = name;
    let note = `name "${lemma ?? name}"`;
    // "станція метро Хрещатик": nothing is called that, so drop the type words and look for a
    // station called "Хрещатик". Only features of that type count, or "Gare du Nord" would find "Rue du Nord".
    if ((all[0]?.score ?? 0) < GOOD_SCORE) {
      const cores = queries.map((q) => stripCategoryWords(q)).filter((c): c is NonNullable<typeof c> => !!c);
      if (cores.length) {
        const alt = searchByName([...new Set(cores.map((c) => c.core))], gazetteer).filter((m) => m.feature.category === cores[0].category);
        if ((alt[0]?.score ?? 0) >= GOOD_SCORE) {
          all = alt;
          category = category ?? cores[0].category;
          saidForExplicit = stripCategoryWords(name)?.core ?? cores[0].core;
          note = `name "${cores[0].core}" (type words dropped)`;
        }
      }
    }
    const best = all[0]?.score ?? 0;
    note += ` best score ${best.toFixed(2)}`;
    // An exact name beats a name that merely contains it: "Châtelet du Château de Vincennes" for
    // "Château de Vincennes", the bell tower "Дзвіниця Софійського собору" for "Софійського собору".
    // With a case ending the exact name scores lower than the longer one, and still wins.
    const exact = all.filter((m) => m.exact && m.score >= GOOD_SCORE);
    const pool = exact.length ? exact : all;
    if (exact.length && pool[0] !== all[0]) note += `; whole name "${pool[0].feature.name}" preferred to "${all[0].feature.name}"`;
    let good = pool.filter((m) => m.score >= GOOD_SCORE && m.score >= pool[0].score - SCORE_MARGIN);
    if (good.length > 1 && category && categoryIsExplicit(transcript, saidForExplicit, category)) {
      const ofCat = good.filter((m) => m.feature.category === category);
      if (ofCat.length) {
        good = ofCat;
        note += `; narrowed to ${category} (said outright)`;
      }
    }
    // "Vincennes metro": the station called exactly "Vincennes" is the RER, and the metro station
    // with that name in it is "Château de Vincennes". The whole name and the word "metro" point to
    // two places, so ask, even when one of them is near [180].
    if (category === "metro_station" && metroIsExplicit(transcript, saidForExplicit)) {
      const trains = good.filter((m) => m.feature.category === "metro_station");
      const metros = all.filter((m) => m.feature.category === "metro_station" && m.feature.subtype === "metro" && m.score >= GOOD_SCORE && !good.includes(m));
      if (trains.length && trains.every((m) => m.feature.subtype !== "metro") && metros.length) {
        const cands = [...trains, ...metros]
          .map((m) => toCandidate(m.feature, ref, intent, last, m.score))
          .sort((a, b) => a.distance_m - b.distance_m)
          .slice(0, MAX_CHOICES);
        return {
          status: "ambiguous",
          candidates: cands,
          question: askQuestion(cands, lang, "metro_station"),
          evidence: {
            rule: "named_metro_or_train",
            detail: `${note}; "metro" said, but "${trains[0].feature.name}" is a ${trains[0].feature.subtype ?? "train"} station; metro with the name: ${metros.map((m) => m.feature.name).join(", ")}`,
          },
        };
      }
    }
    const groups = collapseColocated(good);
    if (groups.length < good.length) note += `; ${good.length - groups.length} co-located duplicate(s) folded in`;
    if (groups.length) {
      const cands = groups.map(({ match, folded }) => {
        const c = toCandidate(match.feature, ref, intent, last, match.score);
        // The folded places widen the circle: "on Maidan" is the whole square, not just the station entrance.
        // Not for a movement: there the circle is the length of the leg, not the size of the place.
        for (const f of c.placement.heading_to || c.placement.estimated ? [] : folded) {
          const r = placementFor(f.feature, intent, last).radius_m;
          if (c.placement.radius_m != null && r != null) c.placement.radius_m = Math.max(c.placement.radius_m, r);
        }
        return c;
      });
      return decide(cands, "named", `${note}; ${cands.length} match(es); ref ${refLabel}`);
    }
    if (category && category !== "street" && category !== "other") {
      const cands = categoryCandidates(category, gazetteer, ref, intent, last);
      return decide(cands, "category", `${note}, not found; ${cands.length} ${category} within ${CATEGORY_RADIUS_M} m of ${refLabel}`, true, name);
    }
    return unresolved("named_none", `${note}; nothing above ${GOOD_SCORE}`);
  }

  if (!category || category === "street" || category === "other") {
    return unresolved("category_too_broad", `category "${category}" without a name cannot be placed`);
  }
  const cands = categoryCandidates(category, gazetteer, ref, intent, last);
  return decide(cands, "category", `${cands.length} ${category} within ${CATEGORY_RADIUS_M} m of ${refLabel}`);
}

function categoryCandidates(category: Category, gazetteer: GazetteerFeature[], ref: LatLon, intent: Intent, last: LastPosition | null | undefined): Candidate[] {
  return gazetteer
    .filter((f) => f.category === category)
    .map((f) => toCandidate(f, ref, intent, last))
    .filter((c) => c.distance_m <= CATEGORY_RADIUS_M);
}

/**
 * "Bérault" is a metro station and the small square above it; "Майдан Незалежності" is a station,
 * a square and a street in the same spot. Those are one place, not a question.
 * A match is folded into an earlier one when they are within COLOCATED_M of each other (or one
 * lies inside the other) and neither is bigger than COLOCATED_MAX_EXTENT_M. Points of interest
 * are kept in preference to streets. "Хрещатик" the 1.2 km street is never folded into its station.
 */
function collapseColocated(matches: NameMatch[]): { match: NameMatch; folded: NameMatch[] }[] {
  const extent = (f: GazetteerFeature) => (f.bbox ? bboxHalfDiagonalM(f.bbox) : 0);
  const inside = (p: LatLon, f: GazetteerFeature) => !!f.bbox && p.lon >= f.bbox[0] && p.lon <= f.bbox[2] && p.lat >= f.bbox[1] && p.lat <= f.bbox[3];
  const nearestOn = (f: GazetteerFeature, to: LatLon): LatLon => (f.lines?.length ? nearestPointOnLines(to, f.lines) : f);
  const sorted = [...matches].sort((a, b) => Number(a.feature.category === "street") - Number(b.feature.category === "street"));
  const kept: { match: NameMatch; folded: NameMatch[] }[] = [];
  for (const m of sorted) {
    const f = m.feature;
    const home = kept.find(({ match: { feature: k } }) => {
      if (extent(f) > COLOCATED_MAX_EXTENT_M || extent(k) > COLOCATED_MAX_EXTENT_M) return false;
      return distanceM(nearestOn(k, f), nearestOn(f, k)) <= COLOCATED_M || inside(k, f) || inside(f, k);
    });
    if (home) home.folded.push(m);
    else kept.push({ match: m, folded: [] });
  }
  return kept;
}

function sameCategory(cands: Candidate[]): Category | null {
  const c = cands[0]?.category;
  return c && cands.every((x) => x.category === c) ? c : null;
}

function resolvedFrom(c: Candidate, cands: Candidate[], rule: string, detail: string): Resolution {
  return {
    status: "resolved",
    pin: c.placement.pin,
    radius_m: c.placement.radius_m,
    heading_to: c.placement.heading_to,
    estimated: c.placement.estimated,
    candidates: cands,
    evidence: { rule, feature_id: c.id, detail: `${detail}; → ${c.name}` },
  };
}
