/**
 * Deterministic resolver: intent + last position + gazetteer → pin, or a question.
 * Pure function. The language model never produces coordinates; every coordinate here
 * comes from the gazetteer or from geometry applied to a gazetteer feature.
 */
import type { Candidate, Category, GazetteerFeature, Intent, LastPosition, Placement, Relation, Resolution } from "./types";
import { bboxHalfDiagonalM, bboxHalfExtentM, destination, distanceM, nearestPointOnLines, type LatLon } from "./geo";
import { categoryIsExplicit, genericCategoryOf, searchByName } from "./gazetteer";

export const AREA_CENTRE: LatLon = { lat: 48.8455, lon: 2.435 };
export const FRESH_MS = 10 * 60 * 1000;
export const CATEGORY_RADIUS_M = 1500;
export const NEAREST_RATIO = 0.4;
/** A name match must score at least this... */
export const GOOD_SCORE = 0.7;
/** ...and be within this of the best match to count as a contender. */
export const SCORE_MARGIN = 0.1;
export const MAX_CHOICES = 3;

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
  towards: 0,
};
const COMPASS: Partial<Record<Relation, number>> = { north_of: 0, east_of: 90, south_of: 180, west_of: 270 };
const COMPASS_OFFSET_M = 100;
const MAX_EXTENT_RADIUS_M = 500;

export interface ResolveInput {
  intent: Intent;
  transcript: string;
  lastPosition?: LastPosition | null;
  /** epoch ms; injected so the function stays pure */
  now: number;
  gazetteer: GazetteerFeature[];
}

/** Where the speaker is if `f` is the landmark they meant. */
export function placementFor(f: GazetteerFeature, relation: Relation | null, kind: Intent["kind"], last: LastPosition | null | undefined): Placement {
  const rel: Relation = relation ?? (kind === "movement" ? "towards" : "near");

  // The landmark's reference point: for a street, the point on it nearest the speaker's last position.
  const anchor: LatLon = f.lines?.length && last ? nearestPointOnLines(last, f.lines) : { lat: f.lat, lon: f.lon };

  if (rel === "towards") {
    return {
      pin: last ? { lat: last.lat, lon: last.lon } : undefined,
      heading_to: { lat: anchor.lat, lon: anchor.lon, id: f.id, name: f.name },
    };
  }

  // Size of the feature itself is uncertainty too: "at the park" is anywhere in the park.
  let extent = 0;
  if (f.category === "street") extent = last ? 40 : f.bbox ? Math.min(400, bboxHalfDiagonalM(f.bbox)) : 150;
  else if (f.bbox) extent = Math.min(MAX_EXTENT_RADIUS_M, bboxHalfDiagonalM(f.bbox));

  const bearing = COMPASS[rel];
  if (bearing !== undefined) {
    const off = (f.bbox && f.category !== "street" ? Math.min(MAX_EXTENT_RADIUS_M, bboxHalfExtentM(f.bbox, bearing)) : 0) + COMPASS_OFFSET_M;
    return { pin: destination(anchor, bearing, off), radius_m: REL_RADIUS[rel] };
  }

  return { pin: { lat: anchor.lat, lon: anchor.lon }, radius_m: Math.round(Math.max(REL_RADIUS[rel], extent)) };
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
    score,
    placement: placementFor(f, intent.relation, intent.kind, last),
  };
}

const CAT_LABEL: Record<Category, { en: string; fr: string; frWhich: string }> = {
  church: { en: "church", fr: "église", frWhich: "Quelle église" },
  metro_station: { en: "station", fr: "station", frWhich: "Quelle station" },
  castle: { en: "castle", fr: "château", frWhich: "Quel château" },
  town_hall: { en: "town hall", fr: "mairie", frWhich: "Quelle mairie" },
  school: { en: "school", fr: "école", frWhich: "Quelle école" },
  park: { en: "park", fr: "parc", frWhich: "Quel parc" },
  hospital: { en: "hospital", fr: "hôpital", frWhich: "Quel hôpital" },
  police: { en: "police station", fr: "commissariat", frWhich: "Quel commissariat" },
  bridge: { en: "bridge", fr: "pont", frWhich: "Quel pont" },
  street: { en: "street", fr: "rue", frWhich: "Quelle rue" },
  other: { en: "place", fr: "lieu", frWhich: "Quel lieu" },
};

/** Choice labels; add the category when two choices share a name ("Château de Vincennes (castle)"). */
export function choiceLabels(cands: Candidate[], lang: "en" | "fr"): string[] {
  return cands.map((c) => {
    const clash = cands.some((o) => o !== c && o.name === c.name);
    return clash ? `${c.name} (${CAT_LABEL[c.category][lang]})` : c.name;
  });
}

function joinOr(items: string[], lang: "en" | "fr"): string {
  if (items.length <= 1) return items.join("");
  const or = lang === "fr" ? " ou " : ", or ";
  return items.slice(0, -1).join(", ") + or + items[items.length - 1];
}

function askQuestion(cands: Candidate[], lang: "en" | "fr", category: Category | null, notFound?: string): string {
  const labels = joinOr(choiceLabels(cands, lang), lang);
  const cat = category ? CAT_LABEL[category] : null;
  if (lang === "fr") {
    const lead = notFound ? `Je ne trouve pas « ${notFound} ». ` : "";
    if (cands.length === 1) return `${lead}Vous voulez dire ${labels} ?`;
    return `${lead}${cat ? cat.frWhich : "Lequel"} : ${labels} ?`;
  }
  const lead = notFound ? `I can't find "${notFound}". ` : "";
  if (cands.length === 1) return `${lead}Do you mean ${labels}?`;
  return `${lead}Which ${cat ? cat.en : "one"}: ${labels}?`;
}

function unresolvedPrompt(lang: "en" | "fr"): string {
  return lang === "fr" ? "Je n'ai pas pu vous placer. Donnez le nom d'une rue ou d'un lieu." : "I couldn't place that. Name a street or a landmark.";
}

export function resolve(input: ResolveInput): Resolution {
  const { intent, transcript, lastPosition: last, now, gazetteer } = input;
  const lang = intent.language === "fr" ? "fr" : "en";
  const unresolved = (rule: string, detail: string): Resolution => ({
    status: "unresolved",
    candidates: [],
    question: unresolvedPrompt(lang),
    evidence: { rule, detail },
  });

  if (intent.kind === "other") return unresolved("no_position_in_report", "the report did not state a position or movement");

  let name = intent.landmark_name?.trim() || null;
  let category = intent.landmark_category;

  // "the church", "la mairie": a category word said as if it were a name.
  if (name) {
    const generic = genericCategoryOf(name);
    if (generic !== undefined) {
      name = null;
      category = category ?? generic;
    }
  }
  if (!name && !category) return unresolved("no_landmark", "no landmark name or category in the report");

  const ref: LatLon = last ?? AREA_CENTRE;
  const fresh = !!last && now - last.ts < FRESH_MS;
  const refLabel = last ? (fresh ? "last position" : "stale last position") : "area centre";

  const decide = (cands: Candidate[], prefix: string, extra: string, forceAsk = false, notFound?: string): Resolution => {
    cands.sort((a, b) => a.distance_m - b.distance_m);
    if (!cands.length) return unresolved(`${prefix}_none`, extra);
    if (!forceAsk && cands.length === 1) {
      return resolvedFrom(cands[0], cands, `${prefix}_unique`, `${extra}; one candidate`);
    }
    if (!forceAsk && fresh && cands[0].distance_m < NEAREST_RATIO * cands[1].distance_m) {
      return resolvedFrom(
        cands[0],
        cands.slice(0, MAX_CHOICES),
        `${prefix}_nearest_wins`,
        `${extra}; nearest ${cands[0].distance_m} m < ${NEAREST_RATIO} × second ${cands[1].distance_m} m from fresh last position`,
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

  if (name) {
    const all = searchByName(name, gazetteer);
    const best = all[0]?.score ?? 0;
    let good = all.filter((m) => m.score >= GOOD_SCORE && m.score >= best - SCORE_MARGIN);
    let note = `name "${name}" best score ${best.toFixed(2)}`;
    // An exact name beats a name that merely contains it ("Châtelet du Château de Vincennes").
    if (good.some((m) => m.exact)) good = good.filter((m) => m.exact);
    if (good.length > 1 && category && categoryIsExplicit(transcript, name, category)) {
      const ofCat = good.filter((m) => m.feature.category === category);
      if (ofCat.length) {
        good = ofCat;
        note += `; narrowed to ${category} (said outright)`;
      }
    }
    if (good.length) {
      const cands = good.map((m) => toCandidate(m.feature, ref, intent, last, m.score));
      return decide(cands, "named", `${note}; ${good.length} match(es); ref ${refLabel}`);
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
    candidates: cands,
    evidence: { rule, feature_id: c.id, detail: `${detail}; → ${c.name}` },
  };
}
