/**
 * Tracks: things on the map that are not a reporting unit. A unit reports one by voice ("enemy
 * vehicle in front of the town hall", "drone 300 metres north of me") and the coordinator numbers
 * it ("Track 3"). For reconnaissance only: a track records who saw what, where, when, and how
 * sure the place is. Nothing here pairs a track with anything that could act on it.
 *
 * Pure, like the resolver, and safe to import on the client. Three things are decided here in
 * code, from the words, not by the model:
 *   - whether the report is about the speaker or about a track (the model's reading is checked);
 *   - whose the track is: hostile only when a hostile word was said, otherwise unknown;
 *   - where it is: a place from the gazetteer, or dead reckoning from the observer's position.
 * A report about a track never moves the speaker.
 */
import { resolve, type ResolveInput } from "./resolver";
import { blocksSaid } from "./blocks";
import { readGrid } from "./grid";
import { withFacing } from "./clock";
import type { Affiliation, Candidate, Direction, Intent, Placement, Resolution, TrackKind, TrackResolution } from "./types";

/** A track seen "on" a street or along a river is somewhere along it, not at the point nearest the observer. */
export const TRACK_ON_LINE_M = 150;

type Lang = "en" | "fr" | "uk";
const CYRILLIC = /[\u0400-\u04ff]/;

/** Lower case, Latin accents dropped, punctuation out. "L'ennemi" keeps "ennemi"; "об'єкт" becomes "обєкт". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u00c0-\u024f]/g, (c) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .replace(/([\u0400-\u04ff])[\u2019\u02bc'`]([\u0400-\u04ff])/g, "$1$2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words in dictionary form for English and French; stems for Ukrainian and Russian, which inflect. */
interface Lexicon {
  words: string[];
  stems?: string[];
  phrases?: string[];
}

function says(lex: Lexicon, toks: string[], text: string): boolean {
  if (toks.some((t) => lex.words.includes(t) || (CYRILLIC.test(t) && (lex.stems ?? []).some((s) => t.startsWith(s))))) return true;
  return (lex.phrases ?? []).some((p) => ` ${text} `.includes(` ${p} `));
}

const HOSTILE: Lexicon = {
  // Field words too [224]: "OPFOR", "bandits", "orcs" (Ukrainian soldiers' word for the enemy).
  words: ["enemy", "enemies", "hostile", "hostiles", "opfor", "bandit", "bandits", "orc", "orcs", "ennemi", "ennemie", "ennemis", "ennemies", "adverse", "adversaire", "adversaires"],
  stems: ["ворож", "ворог", "противник", "враг", "вражеск", "неприятел", "орки", "орків", "оркам", "орка"],
};
const SUSPECT: Lexicon = { words: ["suspect", "suspects", "suspected", "suspicious", "suspecte", "suspectes"], stems: ["підозр", "подозр"] };
/** Doubt about a hostile word makes a suspect ("possible enemy vehicle"); doubt alone says nothing about whose it is. */
const DOUBT: Lexicon = {
  words: ["possible", "possibly", "probable", "probably", "maybe", "likely", "presumed", "presume", "presumee", "probablement"],
  stems: ["ймовірн", "імовірн", "можлив", "вероятн", "возможн"],
};
const FRIENDLY: Lexicon = {
  words: ["friendly", "friendlies", "blufor", "allied", "ally", "our", "ours", "ami", "amie", "amis", "amies", "allie", "allies", "notre", "nos", "свій", "своя", "своє", "свої", "своїх", "наш", "наша", "наше", "наші", "наших", "нашого", "нашої", "нашу"],
  stems: ["дружн", "союзн"],
};
const NEUTRAL: Lexicon = {
  words: ["civilian", "civilians", "neutral", "civil", "civile", "civils", "civiles", "neutre", "neutres"],
  stems: ["цивільн", "нейтральн", "гражданск"],
};

/** The more particular kinds first: a drone team is not a drone, a tank is not just a vehicle. */
const KIND_WORDS: [TrackKind, Lexicon][] = [
  [
    "drone_team",
    {
      words: [],
      phrases: [
        "drone team", "drone teams", "uav team", "drone crew", "uav crew", "drone operator", "drone operators",
        "equipe drone", "equipe de drone", "equipe de drones", "operateur de drone", "operateurs de drone", "operateurs de drones",
        "розрахунок бпла", "розрахунок дронів", "екіпаж бпла", "екіпаж дрона", "оператор дрона", "оператори дронів", "оператори бпла",
      ],
    },
  ],
  [
    "drone",
    {
      // Models soldiers name them by [224]: Mavic, Shahed, Lancet, Orlan.
      words: ["drone", "drones", "uav", "uavs", "uas", "quadcopter", "quadcopters", "fpv", "fpvs", "mavic", "mavics", "shahed", "shaheds", "lancet", "lancets", "orlan", "orlans", "geran", "бпла"],
      stems: ["дрон", "безпілотник", "беспилотник", "квадрокоптер", "коптер", "мавік", "мавик", "шахед", "ланцет", "орлан", "герань"],
      phrases: ["loitering munition", "kamikaze drone", "munition rodeuse"],
    },
  ],
  [
    "armour",
    {
      words: ["tank", "tanks", "apc", "apcs", "ifv", "ifvs", "mbt", "mbts", "bmp", "bmps", "btr", "btrs", "bmd", "mrap", "mraps", "armour", "armor", "armoured", "armored", "char", "chars", "blinde", "blindes", "blindee", "blindees", "vbci", "vab", "бмп", "бтр", "ббм", "бмд"],
      stems: ["танк", "бронемашин", "бронетехнік", "бронетехник", "бронетранспортер"],
      // "T-72" folds to "t 72" [224].
      phrases: ["t 62", "t 64", "t 72", "t 80", "t 90", "т 62", "т 64", "т 72", "т 80", "т 90", "mt lb", "мт лб"],
    },
  ],
  ["mortar", { words: ["mortar", "mortars", "mortier", "mortiers"], stems: ["міномет", "миномет"] }],
  [
    "artillery",
    {
      words: ["artillery", "howitzer", "howitzers", "gun", "guns", "cannon", "mlrs", "grad", "grads", "himars", "smerch", "uragan", "msta", "artillerie", "canon", "canons", "obusier", "obusiers", "caesar", "lrm", "сау", "рсзо", "град", "гради"],
      stems: ["артилер", "артиллер", "гармат", "гаубиц", "пушк", "градів", "хаймарс", "смерч", "ураган"],
    },
  ],
  ["jammer", { words: ["jammer", "jammers", "jamming", "brouilleur", "brouilleurs", "brouillage", "реб", "рэб"], stems: ["глушилк", "глушник"], phrases: ["electronic warfare", "guerre electronique"] }],
  [
    "people",
    {
      words: [
        "person", "persons", "people", "man", "men", "soldier", "soldiers", "infantry", "troops", "patrol", "squad", "fighter", "fighters", "gunman", "gunmen", "individual", "individuals", "personnel",
        "sniper", "snipers", "dismount", "dismounts", "dismounted", "rifleman", "riflemen", "sapper", "sappers", "saboteur", "saboteurs",
        "personne", "personnes", "homme", "hommes", "soldat", "soldats", "fantassin", "fantassins", "infanterie", "patrouille", "individu", "individus", "combattant", "combattants",
        "tireur", "tireurs", "snipeur", "snipeurs", "debarques",
        "люди", "дрг",
      ],
      stems: ["людин", "люде", "солдат", "піхот", "пехот", "бійц", "боєц", "військов", "патрул", "боец", "бойц", "человек", "снайпер", "диверсант", "сапер"],
    },
  ],
  [
    "vehicle",
    {
      words: [
        "vehicle", "vehicles", "car", "cars", "truck", "trucks", "pickup", "pickups", "van", "vans", "jeep", "jeeps", "lorry", "lorries", "convoy",
        "vehicule", "vehicules", "voiture", "voitures", "camion", "camions", "camionnette", "convoi",
        "авто",
      ],
      stems: ["машин", "автомобіл", "автомобил", "вантажівк", "грузовик", "пікап", "пикап", "колон"],
    },
  ],
];

/** Words for a thing still on its way somewhere. Without one, "Track 3 moved to the station" means it is there. */
const ON_ITS_WAY: Lexicon = {
  words: ["towards", "toward", "heading", "approaching", "vers", "direction", "approche", "dirige"],
  stems: ["напрям", "прямує", "наближа", "рухаєт", "направлен", "движет", "приближа"],
  phrases: ["en route", "on its way", "on the way", "в бік"],
};

/** The word a track is named by: "Track 3", "Piste 3", "Об'єкт 3". */
const DESIGNATOR: Lexicon = { words: ["track", "piste"], stems: ["обєкт", "объект", "трек"] };
const NUMBER_FILLER = new Set(["number", "no", "n", "numero", "num", "номер"]);
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20,
  один: 1, одна: 1, одне: 1, два: 2, дві: 2, три: 3, чотири: 4, пять: 5, шість: 6, сім: 7, вісім: 8, девять: 9, десять: 10,
  одинадцять: 11, дванадцять: 12, тринадцять: 13, чотирнадцять: 14, пятнадцять: 15, шістнадцять: 16, сімнадцять: 17, вісімнадцять: 18, девятнадцять: 19, двадцять: 20,
  четыре: 4, шесть: 6, семь: 7, восемь: 8,
};

/** "Contact": the radio word for something seen ("Contact, two blocks east", "contact ennemi", "невідомий контакт"). */
const CONTACT: Lexicon = { words: ["contact", "contacts"], stems: ["контакт"] };
/** Words that make "contact" a sighting when they stand next to it, besides whose it is and doubt. */
const CONTACT_QUALIFIER: Lexicon = {
  words: ["unknown", "unidentified", "new", "visual", "inconnu", "inconnue", "inconnus", "inconnues", "nouveau", "nouvel", "nouvelle", "nouveaux", "visuel"],
  stems: ["невідом", "неизвестн", "нов", "візуальн", "визуальн"],
};

/**
 * True when the speaker reports a contact: something seen. "Contact" counts as the first word, or
 * next to a word for whose it is, for doubt, unknown, new or visual, or a count ("two contacts").
 * "Lost contact with BRAVO", "in contact" and "pas de contact" do not count.
 */
export function contactSaid(transcript: string): boolean {
  const toks = fold(transcript).split(" ");
  const is = (lex: Lexicon, t: string | undefined) => t != null && says(lex, [t], "");
  const qualifies = (t: string | undefined) =>
    t != null && ([CONTACT_QUALIFIER, HOSTILE, SUSPECT, DOUBT, FRIENDLY, NEUTRAL].some((lex) => is(lex, t)) || /^\d{1,3}$/.test(t) || NUMBER_WORDS[t] != null);
  return toks.some((t, i) => is(CONTACT, t) && (i === 0 || qualifies(toks[i - 1]) || qualifies(toks[i + 1])));
}

/** "Track 3", "piste numéro trois", "об'єкт три": the number, read from the words. Null when no track is named. */
export function trackNumberSaid(transcript: string): number | null {
  const toks = fold(transcript).split(" ");
  for (let i = 0; i < toks.length - 1; i++) {
    if (!says(DESIGNATOR, [toks[i]], "")) continue;
    const next = NUMBER_FILLER.has(toks[i + 1]) ? toks[i + 2] : toks[i + 1];
    if (!next) continue;
    const n = /^\d{1,3}$/.test(next) ? Number(next) : NUMBER_WORDS[next];
    if (n && n > 0) return n;
  }
  return null;
}

/**
 * Whose the thing is, from the words alone. The model has no say in this: nothing is marked
 * hostile unless the speaker said so. Null when no word for it was said.
 */
export function affiliationSaid(transcript: string): Affiliation | null {
  const text = fold(transcript);
  const toks = text.split(" ");
  const hostile = says(HOSTILE, toks, text);
  if (says(SUSPECT, toks, text) || (hostile && says(DOUBT, toks, text))) return "suspect";
  if (hostile) return "hostile";
  if (says(FRIENDLY, toks, text)) return "friendly";
  if (says(NEUTRAL, toks, text)) return "neutral";
  return null;
}

/** The kind of thing, from a type word in what was said. Null when none was said. */
export function kindSaid(transcript: string): TrackKind | null {
  const text = fold(transcript);
  const toks = text.split(" ");
  return KIND_WORDS.find(([, lex]) => says(lex, toks, text))?.[0] ?? null;
}

export interface Reading {
  /** `unclear`: the model and the words disagree about who the report is about, so the app asks. */
  subject: "self" | "track" | "unclear";
  /** The track the speaker named, if any. */
  ref: number | null;
  affiliation: Affiliation | null;
  kind: TrackKind | null;
  why: string;
}

/**
 * Who the report is about. The model says "self" or "track"; the words have to agree.
 *   - A track named by its number ("Track 3 moved to the station") is a track, whatever the model said.
 *   - A contact ("Unknown contact, two blocks east") is a track, whatever the model said. Hosted
 *     Mistral read that one as the speaker moving east. A track never moves the speaker, so this
 *     reading is the safe one when it is wrong.
 *   - The model says track, and the words name a kind of thing or whose it is: a track.
 *   - The model says track, and the words name neither: unclear.
 *   - The model says self, and a hostile or suspect word was said: unclear. Moving a friendly
 *     marker onto an enemy's place, or the other way round, is the mistake this guards against.
 *   - The model says self, and the words name a kind of thing and whose it is ("our drone team is
 *     at the station", "civilian car near the cemetery"): unclear. Hosted Mistral read the first
 *     as the speaker's own position and moved the unit there.
 *   - Otherwise the speaker, as before tracks existed.
 */
export function readSubject(intent: Intent, transcript: string): Reading {
  const numbered = trackNumberSaid(transcript);
  const affiliation = affiliationSaid(transcript);
  const wordKind = kindSaid(transcript);
  const modelKind = intent.track_kind && intent.track_kind !== "other" ? intent.track_kind : null;
  const modelTrack = intent.subject === "track";
  const kind = wordKind ?? (modelTrack ? modelKind : null);
  const ref = numbered ?? (modelTrack && Number.isInteger(intent.track_ref) && intent.track_ref! > 0 ? intent.track_ref! : null);
  const base = { ref, affiliation, kind };
  if (numbered != null) return { ...base, subject: "track", why: `the speaker named track ${numbered}` };
  if (contactSaid(transcript)) return { ...base, subject: "track", why: modelTrack ? "read as a track; the words report a contact" : "the words report a contact" };
  if (modelTrack) {
    if (affiliation || wordKind) return { ...base, subject: "track", why: `read as a track; the words say ${[affiliation, wordKind].filter(Boolean).join(" ")}` };
    return { ...base, subject: "unclear", why: "read as a track, but no word names a kind of thing or whose it is" };
  }
  if (affiliation === "hostile" || affiliation === "suspect") {
    return { ...base, subject: "unclear", why: `read as the speaker's own position, but a ${affiliation} word was said` };
  }
  if (affiliation && wordKind) {
    return { ...base, subject: "unclear", why: `read as the speaker's own position, but the words name a ${affiliation} ${wordKind}` };
  }
  return { ...base, ref: null, kind: null, subject: "self", why: "the speaker's own position" };
}

// ---- compass words: where the thing is, and which way it is going ----

type Half = "north" | "south" | "east" | "west";

/**
 * One half of a compass word, from one folded word. French "est" is also "is", so it counts only
 * after "l'", "plein" or "cap", or as the second half of "nord-est" and "sud-est".
 */
function halfOf(t: string, prev: string | undefined): Half | null {
  if (["north", "northern", "nord"].includes(t) || /^(північ|півноч|север)/.test(t)) return "north";
  if (["south", "southern", "sud", "юг", "юга", "югу", "юго"].includes(t) || /^(півден|півдн|южн)/.test(t)) return "south";
  if (["east", "eastern", "восток", "востока"].includes(t) || /^(схід|сход|східн|восточн)/.test(t)) return "east";
  if (t === "est" && prev != null && ["l", "plein", "cap", "nord", "sud"].includes(prev)) return "east";
  if (["west", "western", "ouest"].includes(t) || /^(захід|заход|західн|запад)/.test(t)) return "west";
  return null;
}

const ONE_WORD: Record<string, Direction> = { northeast: "north_east", northwest: "north_west", southeast: "south_east", southwest: "south_west" };
const BOUND = /^(north|south|east|west|northeast|northwest|southeast|southwest)bound$/;

/** A distance said just before the compass word: "1 km east", "à 300 mètres à l'est", "за кілометр на схід". */
const UNIT: Lexicon = {
  words: ["m", "metre", "metres", "meter", "meters", "km", "kms", "kilometre", "kilometres", "kilometer", "kilometers", "klick", "klicks", "click", "clicks", "yard", "yards", "block", "blocks", "м", "км"],
  stems: ["метр", "кілометр", "километр", "квартал"],
};
/** A verb of moving: the compass word after it is the way the thing is going. */
const GOING: Lexicon = {
  words: [
    "heading", "headed", "heads", "moving", "moves", "moved", "going", "goes", "travelling", "traveling", "travels", "driving", "drives", "flying", "flies", "walking", "advancing", "advances", "retreating", "withdrawing", "proceeding", "turning", "turned", "bound",
    "dirige", "dirigent", "roule", "roulent", "avance", "avancent", "va", "vont", "partent", "filent", "vole", "volent", "deplace", "deplacent", "progresse", "progressent", "remonte", "remontent", "descend", "descendent", "cap",
    "їде", "їдуть", "іде", "йде", "йдуть", "ідуть", "едет", "едут", "идет", "идут",
  ],
  stems: ["рухаєт", "рухают", "летит", "летят", "летять", "прямує", "прямуют", "направля", "движет", "движут", "пересува", "наступа", "відход", "отход"],
};
/** Words that point a way but also say where something is: "à 300 mètres vers l'est" is a place. Weaker than a verb of moving. */
const TOWARD: Lexicon = { words: ["towards", "toward", "vers", "direction", "бік", "сторону"], stems: ["напрям"] };
/** "Coming from the north" says where it came from, neither where it is nor the way it is going. */
const FROM: Lexicon = { words: ["from", "coming", "comes", "venant", "vient", "viennent", "arrivant"] };
const FROM_NEXT_TO = new Set(["з", "із", "зі", "с", "со"]);
/** "I'm moving north", "je me dirige vers le nord": the speaker's own move, not the thing's. */
const FIRST_PERSON = new Set(["i", "im", "we", "je", "nous", "я", "ми", "мы"]);
/** After the compass word, these make it a place: "east of me", "au nord de l'église", "на схід від мене". */
const OF_AFTER = new Set(["of", "from", "de", "du", "des", "від", "от"]);

/** What a compass word says: where the thing is, the way it is going, the speaker's own move, where it came from, or not clear. */
export type CompassRole = "where" | "going" | "self" | "from" | "unclear";
export interface CompassWord {
  dir: Direction;
  role: CompassRole;
}

/**
 * Each compass word in what was said, with what it says. The words around it decide: a distance
 * just before it ("1 km east") puts the thing there; a verb of moving before it ("heading north")
 * is the way it is going; "of" after it ("east of me") puts the thing there.
 */
export function compassWordsSaid(transcript: string): CompassWord[] {
  const toks = fold(transcript).split(" ").filter(Boolean);
  const found: { dir: Direction; start: number; end: number; bound: boolean }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const b = BOUND.exec(t);
    if (b) {
      found.push({ dir: ONE_WORD[b[1]] ?? (b[1] as Direction), start: i, end: i, bound: true });
      continue;
    }
    if (ONE_WORD[t]) {
      found.push({ dir: ONE_WORD[t], start: i, end: i, bound: false });
      continue;
    }
    const a = halfOf(t, toks[i - 1]);
    if (!a) continue;
    const b2 = a === "north" || a === "south" ? halfOf(toks[i + 1] ?? "", t) : null;
    if (b2 === "east" || b2 === "west") {
      found.push({ dir: `${a}_${b2}` as Direction, start: i, end: i + 1, bound: false });
      i++;
    } else found.push({ dir: a, start: i, end: i, bound: false });
  }

  const is = (lex: Lexicon, t: string) => says(lex, [t], "");
  return found.map((w, k) => {
    if (w.bound) return { dir: w.dir, role: "going" as const };
    const stop = k > 0 ? found[k - 1].end : -1;
    let toward = false;
    let near: "going" | "self" | "from" | "where" | null = null;
    for (let j = w.start - 1; j > stop && j >= w.start - 5; j--) {
      const t = toks[j];
      if (is(GOING, t)) {
        near = [toks[j - 1], toks[j - 2]].some((p) => p != null && FIRST_PERSON.has(p)) ? "self" : "going";
        break;
      }
      if (is(FROM, t) || (j === w.start - 1 && FROM_NEXT_TO.has(t))) {
        near = "from";
        break;
      }
      if (is(UNIT, t) || /^\d+(m|km)$/.test(t)) {
        near = "where";
        break;
      }
      if (is(TOWARD, t)) toward = true;
    }
    if (near) return { dir: w.dir, role: near };
    if (OF_AFTER.has(toks[w.end + 1] ?? "")) return { dir: w.dir, role: "where" as const };
    return { dir: w.dir, role: toward ? ("going" as const) : ("unclear" as const) };
  });
}

/** The compass direction a report gave for where a thing is, with no place named: "300 metres north of me". */
function bearingSaid(intent: Intent): Direction | null {
  if (intent.direction) return intent.direction;
  return intent.relation && /_of$/.test(intent.relation) ? (intent.relation.replace(/_of$/, "") as Direction) : null;
}

const only = <T>(xs: T[]): T | null => (new Set(xs).size === 1 ? xs[0] : null);

/**
 * The model's reading of the compass words, checked against the words. A report about a track can
 * hold two: where the thing is from the speaker, and the way it is moving ("hostile drone, 1 km
 * east, heading north"). The offline model (ministral-3:3b) drops one, swaps them or merges them;
 * the swap put the pin 1 km north with no question. The words decide when they are clear:
 *   - a heading is the compass word after a verb of moving; with none, the model's heading stands
 *     only on a compass word whose role is not clear, never on one that says where the thing is;
 *   - with no place named, or blocks counted from one, where it is is the compass word after a
 *     distance or before "of"; with none, the model's direction stands only on a compass word
 *     whose role is not clear.
 * One compass word is not both. Two different ones for the same role are not a reading: that one
 * is left out, and the app asks.
 * When no compass word is found at all, the model's reading is kept: the word lists may miss one.
 * Returns the intent to place with, and what changed, for the evidence.
 */
export function compassChecked(intent: Intent, transcript: string, placeAlone: boolean): { intent: Intent; why: string | null } {
  const words = compassWordsSaid(transcript);
  if (words.length === 0) return { intent, why: null };
  const by = (role: CompassRole) => words.filter((w) => w.role === role).map((w) => w.dir);
  const backed = (d: Direction | null | undefined) => d != null && words.some((w) => w.dir === d && w.role === "unclear");
  const going = by("going");
  const where = by("where");

  const modelBearing = placeAlone ? null : bearingSaid(intent);
  const bearing = placeAlone ? null : where.length ? only(where) : backed(modelBearing) ? modelBearing : null;

  const modelHeading = intent.track_heading ?? null;
  let heading = going.length ? (only(going) ?? (modelHeading && going.includes(modelHeading) ? modelHeading : null)) : backed(modelHeading) ? modelHeading : null;
  // One compass word does not say both where the thing is and the way it is going.
  if (!going.length && heading && heading === bearing && words.filter((w) => w.dir === heading).length === 1) heading = null;

  const changes: string[] = [];
  const out: Intent = { ...intent };
  if (heading !== modelHeading) {
    out.track_heading = heading;
    changes.push(`moving ${heading ?? "not said"} (read ${modelHeading ?? "none"})`);
  }
  if (!placeAlone && bearing !== modelBearing) {
    out.direction = bearing;
    if (intent.relation && /_of$/.test(intent.relation)) out.relation = null;
    changes.push(`${bearing ? `${bearing} of the observer` : "no way from the observer"} (read ${modelBearing ?? "none"})`);
  }
  return changes.length ? { intent: out, why: `the compass words say ${changes.join(", ")}` } : { intent, why: null };
}

// ---- what the app says ----

const DIR_WORDS: Record<Lang, Record<Direction, string>> = {
  en: { north: "north", north_east: "north-east", east: "east", south_east: "south-east", south: "south", south_west: "south-west", west: "west", north_west: "north-west" },
  fr: { north: "au nord", north_east: "au nord-est", east: "à l'est", south_east: "au sud-est", south: "au sud", south_west: "au sud-ouest", west: "à l'ouest", north_west: "au nord-ouest" },
  uk: {
    north: "на північ",
    north_east: "на північний схід",
    east: "на схід",
    south_east: "на південний схід",
    south: "на південь",
    south_west: "на південний захід",
    west: "на захід",
    north_west: "на північний захід",
  },
};

/** French and Ukrainian adjectives agree with the noun: [word, gender]. */
const KIND_SAY: Record<Lang, Record<TrackKind, [string, "m" | "f"]>> = {
  en: { people: ["people", "m"], vehicle: ["vehicle", "m"], armour: ["armoured vehicle", "m"], drone: ["drone", "m"], drone_team: ["drone team", "m"], mortar: ["mortar", "m"], artillery: ["artillery", "m"], jammer: ["jammer", "m"], other: ["contact", "m"] },
  fr: { people: ["personnel", "m"], vehicle: ["véhicule", "m"], armour: ["blindé", "m"], drone: ["drone", "m"], drone_team: ["équipe drone", "f"], mortar: ["mortier", "m"], artillery: ["artillerie", "f"], jammer: ["brouilleur", "m"], other: ["contact", "m"] },
  uk: { people: ["піхота", "f"], vehicle: ["машина", "f"], armour: ["бронетехніка", "f"], drone: ["дрон", "m"], drone_team: ["розрахунок дронів", "m"], mortar: ["міномет", "m"], artillery: ["артилерія", "f"], jammer: ["засіб РЕБ", "m"], other: ["", "m"] },
};
const AFFILIATION_SAY: Record<Lang, Record<Affiliation, [string, string]>> = {
  en: { hostile: ["hostile", "hostile"], suspect: ["suspect", "suspect"], unknown: ["unknown", "unknown"], neutral: ["civilian", "civilian"], friendly: ["friendly", "friendly"] },
  fr: { hostile: ["hostile", "hostile"], suspect: ["suspect", "suspecte"], unknown: ["inconnu", "inconnue"], neutral: ["civil", "civile"], friendly: ["ami", "amie"] },
  uk: { hostile: ["ворожий", "ворожа"], suspect: ["підозрілий", "підозріла"], unknown: ["невідомий", "невідома"], neutral: ["цивільний", "цивільна"], friendly: ["дружній", "дружня"] },
};

const WORDS: Record<Lang, { track: (n: number) => string; now: string; count: (c: number) => string; fromYou: (d: number, dir: string) => string; unsaved: string }> = {
  en: { track: (n) => `Track ${n}`, now: "now", count: (c) => `count ${c}`, fromYou: (d, dir) => `${d} metres ${dir} of you`, unsaved: "Not numbered: no mission." },
  fr: { track: (n) => `Piste ${n}`, now: "maintenant", count: (c) => `nombre ${c}`, fromYou: (d, dir) => `${d} mètres ${dir} de vous`, unsaved: "Sans numéro : pas de mission." },
  uk: { track: (n) => `Об'єкт ${n}`, now: "тепер", count: (c) => `кількість ${c}`, fromYou: (d, dir) => `${d} метрів ${dir} від вас`, unsaved: "Без номера: немає місії." },
};

/** "hostile vehicle", "véhicule hostile", "ворожа машина". A new track with nothing said is an unknown contact. */
function describeSaid(t: TrackResolution, lang: Lang): string {
  const affiliation = t.affiliation ?? (t.opened ? "unknown" : null);
  const kind = t.kind ?? (t.opened ? "other" : null);
  const [noun, gender] = kind ? KIND_SAY[lang][kind] : ["", "m" as const];
  const adjective = affiliation ? AFFILIATION_SAY[lang][affiliation][gender === "f" ? 1 : 0] : "";
  const words = lang === "fr" ? [noun, adjective] : [adjective, noun];
  return words.filter(Boolean).join(" ");
}

/** A place, by name or by kind. */
const placeSaid = (intent: Intent) => !!(intent.landmark_name?.trim() || intent.landmark_name_lemma?.trim() || intent.landmark_category);
/** A place with no blocks counted from it: then a compass word is not where the thing is. */
const placeAlone = (intent: Intent, transcript: string) => placeSaid(intent) && !blocksSaid(transcript);

/**
 * What the phone says back: "Track 3, unknown vehicle, Mairie de Vincennes." The compass words are
 * checked against what was said, as when the track was placed.
 */
export function sayBack(res: Resolution, read: Intent, transcript: string): string | undefined {
  const t = res.track;
  if (!t || res.status !== "resolved") return undefined;
  const intent = compassChecked(read, transcript, placeAlone(read, transcript)).intent;
  const lang: Lang = intent.language === "fr" || intent.language === "uk" ? intent.language : "en";
  const w = WORDS[lang];
  const said = describeSaid(t, lang);
  const what = [said, t.count && t.count > 1 ? w.count(t.count) : ""].filter(Boolean).join(", ");
  let where = "";
  if (t.placement?.pin) {
    const dir = bearingSaid(intent);
    where = res.evidence.rule === "dead_reckoned" && intent.distance_m && dir ? w.fromYou(intent.distance_m, DIR_WORDS[lang][dir]) : (t.label ?? "");
    if (where && !t.opened) where = `${w.now} ${where}`;
  }
  const parts = [t.n != null ? w.track(t.n) : "", what, where].filter(Boolean);
  const line = `${parts.join(", ")}.`;
  const sentence = line.charAt(0).toUpperCase() + line.slice(1);
  return t.n == null ? `${sentence} ${w.unsaved}` : sentence;
}

/**
 * The reply once the track has its number: the number is set, the words to say back are written,
 * and a question starts with the number ("Track 3. Which church: …?"). With no number (a report
 * sent outside a mission is not kept), the words say so.
 */
export function withTrackNumber(res: Resolution, n: number | null, intent: Intent, transcript: string): Resolution {
  if (!res.track) return res;
  const lang: Lang = intent.language === "fr" || intent.language === "uk" ? intent.language : "en";
  const out: Resolution = { ...res, track: { ...res.track, n: n ?? res.track.n } };
  const number = out.track!.n;
  if (res.status === "ambiguous" && number != null && res.question) out.question = `${WORDS[lang].track(number)}. ${res.question}`;
  const say = sayBack(out, intent, transcript);
  if (say) out.track!.say = say;
  return out;
}

type TrackPrompt = "subject" | "where" | "how_far" | "which_way" | "no_observer";

/** `dir`: the way the speaker already gave, so "how far" asks only for the distance. */
function prompt(lang: Lang, which: TrackPrompt, dir: Direction | null = null): string {
  if (which === "how_far" && dir) {
    if (lang === "fr") return `À quelle distance ${DIR_WORDS.fr[dir]} ? Ou donnez un lieu proche.`;
    if (lang === "uk") return `Як далеко ${DIR_WORDS.uk[dir]}? Або назвіть орієнтир поруч.`;
    return `How far ${DIR_WORDS.en[dir]} is it? Or name a place near it.`;
  }
  if (which === "which_way") {
    if (lang === "fr") return "Dans quelle direction depuis vous ? Donnez un point cardinal, ou un lieu proche.";
    if (lang === "uk") return "У якому напрямку від вас? Назвіть сторону світу або орієнтир поруч.";
    return "Which way is it from you? Give a compass direction, or name a place near it.";
  }
  if (which === "subject") {
    if (lang === "fr") return "C'est votre position, ou quelque chose que vous voyez ? Dites « je suis à » ou « je vois ».";
    if (lang === "uk") return "Це ваше місце чи те, що ви бачите? Скажіть «я біля» або «бачу».";
    return 'Is that where you are, or something you see? Say "I am at" or "I see".';
  }
  if (which === "how_far") {
    if (lang === "fr") return "À quelle distance, et dans quelle direction ? Ou donnez un lieu proche.";
    if (lang === "uk") return "На якій відстані і в якому напрямку? Або назвіть орієнтир поруч.";
    return "How far is it, and which way? Or name a place near it.";
  }
  if (which === "no_observer") {
    if (lang === "fr") return "Je ne sais pas où vous êtes. Donnez un lieu proche de ce que vous voyez.";
    if (lang === "uk") return "Не знаю, де ви. Назвіть орієнтир поруч із тим, що бачите.";
    return "I don't know where you are. Name a place near what you see.";
  }
  if (lang === "fr") return "Où est-ce ? Donnez un lieu proche, ou une distance et une direction depuis vous.";
  if (lang === "uk") return "Де це? Назвіть орієнтир поруч або відстань і напрямок від вас.";
  return "Where is it? Name a place near it, or a distance and a compass direction from you.";
}

function noSuchTrack(lang: Lang, n: number): string {
  if (lang === "fr") return `Il n'y a pas de piste ${n} dans cette mission.`;
  if (lang === "uk") return `У цій місії немає об'єкта ${n}.`;
  return `There is no Track ${n} in this mission.`;
}

// ---- placing ----

export interface KnownTrack {
  n: number;
}

export interface ReportResolveInput extends ResolveInput {
  /** The tracks open in the mission, so a number the speaker says can be checked. */
  tracks?: KnownTrack[];
  /** The speaker's call sign, for the label of a track placed from where they are. */
  observer?: string;
}

/** A candidate for a track: its placement moves to `track_placement`, so nothing moves the speaker. */
function forTrack(c: Candidate): Candidate {
  const line = c.category === "street" || c.category === "water";
  const pl: Placement = { ...c.placement, heading_to: undefined };
  if (line && pl.radius_m != null) pl.radius_m = Math.max(pl.radius_m, TRACK_ON_LINE_M);
  return { ...c, placement: {}, track_placement: pl };
}

/**
 * Resolves any report: about the speaker, as before, or about a track.
 * For a track the place is found with the same rules as a position report, measured from the
 * observer: "the church" is the one nearest them, and "300 metres north of me" is dead reckoning
 * from where they are. A direction with no distance, or "towards", gives no point, so the app asks.
 * The compass words are checked against what was said first (`compassChecked`).
 */
export function resolveReport(input: ReportResolveInput): Resolution {
  const { intent: said, transcript } = input;
  const lang: Lang = said.language === "fr" || said.language === "uk" ? said.language : "en";
  const reading = readSubject(said, transcript);
  if (reading.subject === "self") return resolve(input);
  if (reading.subject === "unclear") {
    return { status: "unresolved", candidates: [], question: prompt(lang, "subject"), evidence: { rule: "subject_unclear", detail: reading.why } };
  }
  // A grid reference is a place too: "two vehicles at grid DQ 586 101" [223].
  const grid = readGrid(transcript, input.areaCentre ?? { lat: 48.8455, lon: 2.435 });
  const hasPlace = placeSaid(said) || grid != null;
  const alone = placeAlone(said, transcript);
  const checked = compassChecked(said, transcript, alone);
  const intent = checked.intent;
  const why = checked.why ? `${reading.why}; ${checked.why}` : reading.why;

  const count = Number.isInteger(intent.track_count) && intent.track_count! > 0 && intent.track_count! < 1000 ? intent.track_count! : null;
  const track: TrackResolution = {
    n: reading.ref,
    opened: reading.ref == null,
    affiliation: reading.affiliation,
    kind: reading.kind,
    count,
    text: intent.track_text?.trim() || null,
    heading: intent.track_heading ?? null,
  };
  const ask = (rule: string, detail: string, which: TrackPrompt): Resolution => ({
    status: "unresolved",
    candidates: [],
    question: prompt(lang, which, bearingSaid(intent)),
    evidence: { rule, detail: `${why}; ${detail}` },
    track,
  });

  if (reading.ref != null && !(input.tracks ?? []).some((t) => t.n === reading.ref)) {
    return { status: "unresolved", candidates: [], question: noSuchTrack(lang, reading.ref), evidence: { rule: "track_unknown", detail: `${why}; the mission has no track ${reading.ref}` }, track };
  }

  const hasMove = intent.distance_m != null || bearingSaid(intent) != null;
  if (!hasPlace && !hasMove) {
    // "Track 3 is hostile": nothing about where, so only what the track is changes.
    if (reading.ref != null && (track.affiliation || track.kind || track.count)) {
      return { status: "resolved", candidates: [], evidence: { rule: "track_described", detail: `${why}; no place said, so the track stays where it is` }, track };
    }
    return ask("track_no_place", "nothing says where it is", "where");
  }
  // "Heading towards the bridge" says where it is going, not where it is. The model also reads
  // "moved to the station" as "towards"; with no word for being on the way, the thing is there.
  let relation = intent.relation;
  if (hasPlace && relation === "towards") {
    const text = fold(transcript);
    if (says(ON_ITS_WAY, text.split(" "), text)) return ask("track_towards_only", "only where it is heading was said", "where");
    relation = "at";
  }

  // Where the thing is, read as a position: a place with a relation, or a distance and a bearing
  // from the observer. With a place, a compass word is not where the thing is (`track_heading` has
  // the way it is moving), unless blocks are counted that way: "two blocks east on Avenue de Paris".
  const where: Intent = { ...intent, kind: "position", relation, direction: alone ? null : intent.direction };
  const r = resolve({ ...input, intent: where });
  const evidence = { ...r.evidence, detail: `${why}; ${r.evidence.detail}` };

  if (r.status === "ambiguous") return { status: "ambiguous", candidates: r.candidates.map(forTrack), question: r.question, evidence, track };
  // Blocks that could not be counted: how far. From a place, the resolver's question names it.
  if (r.evidence.rule === "blocks_uncounted") {
    const q = ask(r.evidence.rule, r.evidence.detail, "how_far");
    return hasPlace && r.question ? { ...q, question: r.question } : q;
  }
  if (r.status === "unresolved" || !r.pin) {
    const noStart = ["dead_reckoning_no_start", "crossing_no_start", "blocks_no_start"].includes(r.evidence.rule);
    const which: TrackPrompt = noStart ? "no_observer" : r.evidence.rule === "move_incomplete" ? (intent.distance_m != null ? "which_way" : "how_far") : "where";
    return ask(r.evidence.rule, r.evidence.detail, which);
  }

  const target = r.candidates.find((c) => c.id === r.evidence.feature_id);
  const line = target?.category === "street" || target?.category === "water";
  const radius_m = line && r.radius_m != null ? Math.max(r.radius_m, TRACK_ON_LINE_M) : r.radius_m;
  const dir = bearingSaid(withFacing(intent, transcript).intent); // turned to the facing said [224]
  const label = target?.name ?? (r.evidence.rule === "grid_reference" && grid ? `grid ${grid.text}` : null) ??
 (intent.distance_m && dir ? `${intent.distance_m} m ${dir.replace("_", "-")} of ${input.observer ?? "the observer"}` : "position");
  return {
    status: "resolved",
    candidates: r.candidates.map(forTrack),
    evidence,
    track: { ...track, placement: { pin: r.pin, radius_m, ...(r.estimated ? { estimated: true } : {}) }, label },
  };
}
