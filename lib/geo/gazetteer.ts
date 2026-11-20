import raw from "../../data/gazetteer.vincennes.json";
import type { Category, GazetteerFeature } from "./types";
import { normalize, tokens } from "./normalize";

interface GazetteerFile {
  source: string;
  built_at: string;
  bbox: { s: number; w: number; n: number; e: number };
  count: number;
  features: GazetteerFeature[];
}

const data = raw as unknown as GazetteerFile;

export function loadGazetteer(): GazetteerFeature[] {
  return data.features;
}

export const GAZETTEER_SOURCE = data.source;

/** Words that carry no identity in a place name. */
const STOPWORDS = new Set([
  "the", "of", "a", "an", "at", "on", "in", "to", "by", "and", "near",
  "de", "du", "des", "la", "le", "les", "l", "d", "au", "aux", "en", "et", "a",
]);

/** Spelling variants mapped to one token before comparison (both query and names). */
const CANON: Record<string, string> = {
  st: "saint",
  ste: "sainte",
  street: "rue",
  road: "rue",
  av: "avenue",
  ave: "avenue",
  bd: "boulevard",
  bld: "boulevard",
  blvd: "boulevard",
  church: "eglise",
  chapel: "chapelle",
  castle: "chateau",
  metro: "metro",
};

/** Category words in English and French, as canonical tokens. Used to spot "generic" names and explicit category words. */
export const CATEGORY_WORDS: Record<Exclude<Category, "other">, string[]> = {
  church: ["eglise", "chapelle", "temple", "cathedral", "cathedrale", "basilica", "basilique"],
  metro_station: ["metro", "subway", "station", "gare", "underground", "tube", "rer", "stop"],
  castle: ["chateau", "fort", "fortress", "forteresse", "donjon", "keep"],
  town_hall: ["mairie", "town", "city", "hall", "townhall", "hotel", "ville"],
  school: ["school", "ecole", "college", "lycee", "university", "universite", "creche", "kindergarten"],
  park: ["park", "parc", "bois", "garden", "jardin", "woods", "forest", "foret"],
  hospital: ["hospital", "hopital", "clinic", "clinique"],
  police: ["police", "commissariat", "gendarmerie"],
  bridge: ["bridge", "pont", "passerelle"],
  street: ["rue", "avenue", "boulevard", "allee", "place", "quai", "impasse", "passage", "chemin", "route", "villa", "cours", "sentier"],
};

const WORD_TO_CATEGORY = new Map<string, Category>();
for (const [cat, words] of Object.entries(CATEGORY_WORDS)) for (const w of words) if (!WORD_TO_CATEGORY.has(w)) WORD_TO_CATEGORY.set(w, cat as Category);

/** Canonical tokens with stopwords removed (falls back to all tokens if only stopwords remain). */
export function canonTokens(s: string): string[] {
  const all = tokens(s).map((t) => CANON[t] ?? t);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

/**
 * If every token of `name` is a category word ("the church", "la mairie", "metro station"),
 * the name carries no identity: return the category it implies. Otherwise undefined.
 */
export function genericCategoryOf(name: string): Category | null | undefined {
  const toks = canonTokens(name);
  if (!toks.length) return null;
  const cats = toks.map((t) => WORD_TO_CATEGORY.get(t));
  if (cats.some((c) => c === undefined)) return undefined;
  return cats[0] ?? null;
}

/**
 * Was the category said outright, outside the proper name?
 * "the Château de Vincennes metro station" → metro_station explicit.
 * "the château de Vincennes" → castle is only inside the name, so not explicit.
 */
export function categoryIsExplicit(transcript: string, name: string, category: Category): boolean {
  if (category === "other") return false;
  const words = new Set(CATEGORY_WORDS[category]);
  const residual = canonTokens(transcript);
  for (const t of canonTokens(name)) {
    const i = residual.indexOf(t);
    if (i >= 0) residual.splice(i, 1);
  }
  return residual.some((t) => words.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  const r = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return r >= 0.75 ? r : 0;
}

/**
 * Similarity of a spoken name to a gazetteer name, 0..1.
 * 0.6 × how much of the query the name covers + 0.25 × how much of the name the query covers
 * + 0.15 if the query appears as a contiguous phrase in the name (word order matters:
 * "Sainte-Chapelle" should beat "Chapelle Sainte-Bernadette").
 */
export function nameScore(query: string, name: string): number {
  const q = canonTokens(query);
  const n = canonTokens(name);
  if (!q.length || !n.length) return 0;
  const best = (t: string, pool: string[]) => Math.max(...pool.map((p) => tokenSim(t, p)));
  const recall = q.reduce((s, t) => s + best(t, n), 0) / q.length;
  const precision = n.reduce((s, t) => s + best(t, q), 0) / n.length;
  const phrase = ` ${n.join(" ")} `.includes(` ${q.join(" ")} `) ? 1 : 0;
  return 0.6 * recall + 0.25 * precision + 0.15 * phrase;
}

export interface NameMatch {
  feature: GazetteerFeature;
  score: number;
  matched_name: string;
  /** Same canonical tokens in the same order as one of the feature's names. */
  exact: boolean;
}

/** All features scored against `query`, best first. */
export function searchByName(query: string, features: GazetteerFeature[]): NameMatch[] {
  const out: NameMatch[] = [];
  const qKey = canonTokens(query).join(" ");
  for (const f of features) {
    let best = 0;
    let matched = f.name;
    let exact = false;
    for (const n of f.names.length ? f.names : [f.name]) {
      if (canonTokens(n).join(" ") === qKey) exact = true;
      const s = nameScore(query, n);
      if (s > best) {
        best = s;
        matched = n;
      }
    }
    if (best > 0) out.push({ feature: f, score: Math.round(best * 1000) / 1000, matched_name: matched, exact });
  }
  return out.sort((a, b) => b.score - a.score);
}

const BIAS_PRIORITY: Category[] = ["metro_station", "castle", "town_hall", "church", "police", "hospital", "bridge", "park", "other", "street", "school"];
const MAJOR_STREET = /^(trunk|primary|secondary|tertiary)$/;

/** Up to `max` distinct place names to bias speech-to-text, most useful first. */
export function biasTerms(features: GazetteerFeature[], max = 100): string[] {
  const rank = (f: GazetteerFeature) => {
    const base = BIAS_PRIORITY.indexOf(f.category);
    if (f.category === "street") return MAJOR_STREET.test(f.subtype ?? "") ? 8.5 : 9.5;
    return base;
  };
  const sorted = [...features].sort((a, b) => rank(a) - rank(b));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of sorted) {
    const key = normalize(f.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.name);
    if (out.length >= max) break;
  }
  return out;
}
