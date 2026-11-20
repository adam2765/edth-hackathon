import vincennes from "../../data/gazetteer.vincennes.json";
import kyiv from "../../data/gazetteer.kyiv.json";
import type { AreaId } from "./areas";
import type { Category, GazetteerFeature } from "./types";
import { normalize, tokens } from "./normalize";

interface GazetteerFile {
  source: string;
  built_at: string;
  bbox: { s: number; w: number; n: number; e: number };
  count: number;
  features: GazetteerFeature[];
}

const FILES: Record<AreaId, GazetteerFile> = {
  vincennes: vincennes as unknown as GazetteerFile,
  kyiv: kyiv as unknown as GazetteerFile,
};

export function loadGazetteer(area: AreaId = "vincennes"): GazetteerFeature[] {
  return FILES[area].features;
}

export const GAZETTEER_SOURCE = FILES.vincennes.source;

/** Words that carry no identity in a place name. */
const STOPWORDS = new Set([
  "the", "of", "a", "an", "at", "on", "in", "to", "by", "and", "near",
  "de", "du", "des", "la", "le", "les", "l", "d", "au", "aux", "en", "et",
  "на", "в", "у", "біля", "до", "від", "з", "із", "і", "й", "та", "імені", "ім",
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
  вул: "вулиця",
  просп: "проспект",
  пр: "проспект",
  пл: "площа",
  пров: "провулок",
  бул: "бульвар",
  бульв: "бульвар",
};

type NamedCategory = Exclude<Category, "other">;

/** Category words as canonical tokens: English, French, Ukrainian (and common Russian), dictionary form. */
export const CATEGORY_WORDS: Record<NamedCategory, string[]> = {
  church: ["eglise", "chapelle", "temple", "cathedral", "cathedrale", "basilica", "basilique", "церква", "храм", "собор", "костел", "костьол", "каплиця", "церковь"],
  metro_station: ["metro", "subway", "station", "gare", "underground", "tube", "rer", "метро", "станція", "вокзал", "станция"],
  castle: ["chateau", "fort", "fortress", "forteresse", "donjon", "keep", "замок", "фортеця"],
  // "hôtel de ville" becomes "mairie" in canonTokens, so "hotel" alone means a hotel.
  town_hall: ["mairie", "town", "city", "hall", "townhall", "ville", "мерія", "міськрада", "ратуша", "мэрия"],
  school: ["school", "ecole", "college", "lycee", "university", "universite", "creche", "kindergarten", "школа", "ліцей", "гімназія", "університет", "коледж", "інститут"],
  park: ["park", "parc", "bois", "garden", "jardin", "woods", "forest", "foret", "парк", "сквер"],
  cemetery: ["cemetery", "graveyard", "cimetiere", "кладовище", "цвинтар", "кладбище"],
  hospital: ["hospital", "hopital", "clinic", "clinique", "лікарня", "госпіталь", "шпиталь", "поліклініка", "больница"],
  police: ["police", "commissariat", "gendarmerie", "поліція", "відділок", "полиция"],
  bridge: ["bridge", "pont", "passerelle", "міст", "мост"],
  street: [
    "rue", "avenue", "boulevard", "allee", "place", "quai", "impasse", "passage", "chemin", "route", "villa", "cours", "sentier", "square", "lane",
    "вулиця", "проспект", "бульвар", "площа", "провулок", "узвіз", "набережна", "шосе", "улица",
  ],
  stop: ["stop", "busstop", "arret", "bus", "tram", "tramway", "trolleybus", "зупинка", "остановка", "автобус", "трамвай", "тролейбус", "троллейбус"],
  fuel: ["fuel", "petrol", "gas", "carburant", "essence", "заправка", "автозаправка", "азс", "бензоколонка"],
  pharmacy: ["pharmacy", "pharmacie", "chemist", "chemists", "drugstore", "аптека"],
  hotel: ["hotel", "hostel", "motel", "готель", "хостел", "гостиниця", "гостиница"],
  water: ["river", "lake", "pond", "canal", "stream", "riviere", "fleuve", "lac", "etang", "ruisseau", "річка", "озеро", "ставок", "канал", "река"],
  building: ["building", "immeuble", "batiment", "residence", "будівля", "будинок", "корпус", "жк", "здание"],
};

/**
 * Ukrainian nouns change their ending with grammatical case ("біля церкви", "за мостом").
 * A token is a category word if it is one of these stems plus a known case ending.
 * "міст" (bridge) is deliberately not a stem: "міста" means "of the city".
 */
const CATEGORY_STEMS: Record<NamedCategory, string[]> = {
  church: ["церкв", "церков", "храм", "собор", "костел", "костьол", "каплиц"],
  metro_station: ["станці", "станци", "вокзал"],
  castle: ["замк", "фортец"],
  town_hall: ["мері", "міськрад", "ратуш", "мэри"],
  school: ["школ", "ліце", "гімназі", "університет", "коледж", "інститут"],
  park: ["парк", "сквер"],
  cemetery: ["кладовищ", "цвинтар", "кладбищ"],
  hospital: ["лікарн", "госпітал", "шпитал", "поліклінік", "больниц"],
  police: ["поліці", "відділк", "полици"],
  bridge: ["мост"],
  street: ["вулиц", "проспект", "бульвар", "площ", "провулк", "узвоз", "набережн", "улиц"],
  stop: ["зупинк", "зупинц", "остановк", "автобус", "трамва", "тролейбус", "троллейбус"],
  fuel: ["заправк", "заправц", "автозаправк", "автозаправц", "бензоколонк", "бензоколонц"],
  pharmacy: ["аптек", "аптец"],
  hotel: ["готел", "хостел", "гостиниц"],
  // Not "ставк": "ставка" is also a headquarters.
  water: ["річк", "річц", "озер", "рек"],
  building: ["будівл", "будинк", "корпус", "здани"],
};
const CASE_ENDINGS = new Set(["", "а", "я", "у", "ю", "і", "ї", "и", "е", "є", "ь", "й", "ом", "ем", "єм", "ою", "ею", "єю", "ові", "еві", "ій", "ої", "ах", "ях"]);
const CYRILLIC = /[Ѐ-ӿ]/;

const NAMED_CATEGORIES = Object.keys(CATEGORY_WORDS) as NamedCategory[];

export function isCategoryWord(token: string, category: Category): boolean {
  if (category === "other") return false;
  if (CATEGORY_WORDS[category].includes(token)) return true;
  if (!CYRILLIC.test(token)) return false;
  return CATEGORY_STEMS[category].some((stem) => token.startsWith(stem) && CASE_ENDINGS.has(token.slice(stem.length)));
}

export function categoryOfToken(token: string): Category | undefined {
  return NAMED_CATEGORIES.find((c) => isCategoryWord(token, c));
}

/** Type phrases that are one word for our purposes: "hôtel de ville" is a town hall, not a hotel. */
const PHRASES: [string[], string][] = [
  [["hotel", "de", "ville"], "mairie"],
  [["hotel", "ville"], "mairie"],
  [["station", "service"], "carburant"],
  [["station", "essence"], "carburant"],
  [["gas", "station"], "carburant"],
  [["petrol", "station"], "carburant"],
  [["filling", "station"], "carburant"],
  [["service", "station"], "carburant"],
];

function joinPhrases(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; ) {
    const hit = PHRASES.find(([p]) => p.every((w, j) => toks[i + j] === w));
    if (hit) {
      out.push(hit[1]);
      i += hit[0].length;
    } else out.push(toks[i++]);
  }
  return out;
}

/** Canonical tokens with stopwords removed (falls back to all tokens if only stopwords remain). */
export function canonTokens(s: string): string[] {
  const all = joinPhrases(tokens(s)).map((t) => CANON[t] ?? t);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

/**
 * If every token of `name` is a category word ("the church", "la mairie", "церкви"),
 * the name carries no identity: return the category it implies. Otherwise undefined.
 */
export function genericCategoryOf(name: string): Category | null | undefined {
  const toks = canonTokens(name);
  if (!toks.length) return null;
  const cats = toks.map((t) => categoryOfToken(t));
  if (cats.some((c) => c === undefined)) return undefined;
  return cats[0] ?? null;
}

/**
 * "станція метро Хрещатик" → { core: "хрещатик", category: "metro_station" }.
 * null when the name has no category words, or nothing else.
 */
export function stripCategoryWords(name: string): { core: string; category: Category } | null {
  const toks = canonTokens(name);
  const cats = toks.map((t) => categoryOfToken(t));
  const core = toks.filter((_, i) => cats[i] === undefined);
  const first = cats.find((c) => c !== undefined);
  if (!first || !core.length) return null;
  return { core: core.join(" "), category: first };
}

/**
 * Was the category said outright, outside the proper name?
 * "the Château de Vincennes metro station" → metro_station explicit.
 * "the château de Vincennes" → castle is only inside the name, so not explicit.
 */
export function categoryIsExplicit(transcript: string, name: string, category: Category): boolean {
  if (category === "other") return false;
  const residual = canonTokens(transcript);
  for (const t of canonTokens(name)) {
    const i = residual.indexOf(t);
    if (i >= 0) residual.splice(i, 1);
  }
  return residual.some((t) => isCategoryWord(t, category));
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

/**
 * Ukrainian case endings: the same word if the first letters agree and only short endings differ
 * ("Софійського" / "Софійський", "собору" / "собор", "Володимирській" / "Володимирська").
 */
function caseVariant(a: string, b: string): boolean {
  if (!CYRILLIC.test(a) || !CYRILLIC.test(b)) return false;
  const minLen = Math.min(a.length, b.length);
  let cp = 0;
  while (cp < minLen && a[cp] === b[cp]) cp++;
  return cp >= 4 && a.length - cp <= 3 && b.length - cp <= 3;
}

function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  if (caseVariant(a, b)) return 0.85;
  const r = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return r >= 0.75 ? r : 0;
}

/** The whole name, word for word, allowing a Ukrainian case ending on each word. */
function sameName(q: string[], n: string[]): boolean {
  return q.length === n.length && q.every((t, i) => t === n[i] || caseVariant(t, n[i]));
}

function scoreTokens(q: string[], n: string[]): number {
  if (!q.length || !n.length) return 0;
  const best = (t: string, pool: string[]) => Math.max(...pool.map((p) => tokenSim(t, p)));
  const recall = q.reduce((s, t) => s + best(t, n), 0) / q.length;
  const precision = n.reduce((s, t) => s + best(t, q), 0) / n.length;
  const phrase = ` ${n.join(" ")} `.includes(` ${q.join(" ")} `) ? 1 : 0;
  return 0.6 * recall + 0.25 * precision + 0.15 * phrase;
}

/**
 * Similarity of a spoken name to a gazetteer name, 0..1.
 * 0.6 × how much of the query the name covers + 0.25 × how much of the name the query covers
 * + 0.15 if the query appears as a contiguous phrase in the name (word order matters:
 * "Sainte-Chapelle" should beat "Chapelle Sainte-Bernadette").
 */
export function nameScore(query: string, name: string): number {
  return scoreTokens(canonTokens(query), canonTokens(name));
}

interface IndexedName {
  raw: string;
  toks: string[];
  key: string;
}
interface Indexed {
  feature: GazetteerFeature;
  names: IndexedName[];
}
const INDEX = new WeakMap<GazetteerFeature[], Indexed[]>();

function indexOf(features: GazetteerFeature[]): Indexed[] {
  let idx = INDEX.get(features);
  if (idx) return idx;
  idx = features.map((feature) => {
    const names: IndexedName[] = [];
    const add = (raw: string, toks: string[]) => {
      const key = toks.join(" ");
      if (key && !names.some((n) => n.key === key)) names.push({ raw, toks, key });
    };
    for (const raw of feature.names.length ? feature.names : [feature.name]) {
      const toks = canonTokens(raw);
      add(raw, toks);
      // People drop the street word ("на Хрещатику", "on Fontenay"): index streets without it too.
      if (feature.category === "street") {
        const bare = toks.filter((t) => !isCategoryWord(t, "street"));
        if (bare.length && bare.length < toks.length) add(raw, bare);
      }
    }
    return { feature, names };
  });
  INDEX.set(features, idx);
  return idx;
}

export interface NameMatch {
  feature: GazetteerFeature;
  score: number;
  matched_name: string;
  /**
   * Same canonical tokens in the same order as one of the feature's names, allowing a Ukrainian
   * case ending on each ("Софійського собору" is exact for "Софійський собор").
   */
  exact: boolean;
}

/** All features scored against the query (or the best of several spellings of it), best first. */
export function searchByName(query: string | string[], features: GazetteerFeature[]): NameMatch[] {
  const queries = (Array.isArray(query) ? query : [query]).map((q) => canonTokens(q)).filter((q) => q.length);
  const keys = new Set(queries.map((q) => q.join(" ")));
  const out: NameMatch[] = [];
  for (const { feature, names } of indexOf(features)) {
    let best = 0;
    let matched = feature.name;
    let exact = false;
    for (const n of names) {
      if (keys.has(n.key) || queries.some((q) => sameName(q, n.toks))) exact = true;
      for (const q of queries) {
        const s = scoreTokens(q, n.toks);
        if (s > best) {
          best = s;
          matched = n.raw;
        }
      }
    }
    if (best > 0) out.push({ feature, score: Math.round(best * 1000) / 1000, matched_name: matched, exact });
  }
  return out.sort((a, b) => b.score - a.score);
}

const MAJOR_STREET = /^(trunk|primary|secondary|tertiary|pedestrian)$/;
const BIAS_RANK: Record<Category, number> = {
  metro_station: 0,
  castle: 1,
  town_hall: 2,
  bridge: 3,
  water: 3,
  street: 4, // major streets only; minor streets rank last
  church: 5,
  park: 6,
  cemetery: 6,
  police: 7,
  hospital: 8,
  other: 9,
  stop: 9,
  hotel: 10,
  school: 11,
  // Many, and often a chain or a generic name: they would crowd out the landmarks.
  pharmacy: 12,
  fuel: 12,
  building: 12,
};

/** Up to `max` distinct place names to bias speech-to-text, most useful first. */
export function biasTerms(features: GazetteerFeature[], max = 100): string[] {
  const rank = (f: GazetteerFeature) => (f.category === "street" && !MAJOR_STREET.test(f.subtype ?? "") ? 10 : BIAS_RANK[f.category]);
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
