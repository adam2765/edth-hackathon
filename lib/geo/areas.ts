/** Areas the app can work in. Each has its own committed gazetteer file. Safe to import on the client. */
export type AreaId = "vincennes" | "kyiv" | "izium";

export interface Area {
  id: AreaId;
  label: string;
  /** Place description given to the intent extractor. */
  place: string;
  centre: { lat: number; lon: number };
  zoom: number;
  /** Gazetteer bounding box. */
  bbox: { s: number; w: number; n: number; e: number };
  /** Example reports shown under the talk button. */
  hint: string;
  /**
   * Report words given to speech-to-text after the place names, as short phrases in the languages
   * spoken there. Without them Whisper on the phone heard "Hostile drone" as "Hostel Drone" (21 Nov).
   * Phrases did better than single words; more Ukrainian would crowd out Kyiv's place names [189].
   */
  speechWords: string[];
  /** The language of the area's place names, the one its speech-to-text hints pull towards. */
  language: "fr" | "uk";
  /**
   * OSM admin_level of the town inside which street names are unique: the commune in France (8),
   * the city for Kyiv (4), the settlement in the rest of Ukraine (8; the hromada is 7 and holds
   * many villages). The gazetteer build uses it to tell same-name streets apart.
   */
  townAdminLevel: number;
}

export const AREAS: Record<AreaId, Area> = {
  vincennes: {
    id: "vincennes",
    label: "Vincennes",
    place: "Vincennes, France",
    centre: { lat: 48.8455, lon: 2.435 },
    zoom: 14.5,
    // Vincennes centre, the château and three Line 1 stations.
    bbox: { s: 48.835, w: 2.41, n: 48.856, e: 2.46 },
    hint: "Try: “I'm at Bérault metro”, “moving towards the château”, “je suis devant la mairie”.",
    speechWords: ["hostile drone", "enemy vehicle", "friendly", "suspect", "civilian", "Track 2", "drone ennemi", "piste 2"],
    language: "fr",
    townAdminLevel: 8,
  },
  kyiv: {
    id: "kyiv",
    label: "Київ",
    place: "central Kyiv, Ukraine",
    centre: { lat: 50.4501, lon: 30.5234 }, // Maidan Nezalezhnosti
    zoom: 14,
    // Main railway station in the west to the Lavra in the east, Olimpiiska in the south to Podil in the north.
    bbox: { s: 50.428, w: 30.485, n: 50.472, e: 30.565 },
    hint: "Спробуйте: «Я біля Золотих воріт», «Я на Хрещатику», «Рухаюсь до Софійського собору», “I'm at the Golden Gate”.",
    speechWords: ["hostile drone", "Track 2", "ворожий дрон", "свої", "об'єкт 2"],
    language: "uk",
    townAdminLevel: 4,
  },
  izium: {
    id: "izium",
    label: "Ізюм",
    place: "Izium, Kharkiv Oblast, Ukraine",
    centre: { lat: 49.1912, lon: 37.2786 }, // Центральна площа, by the town hall
    zoom: 13,
    // The whole town on both banks of the Siverskyi Donets: Kremenets hill in the south, the railway station in the north-east.
    bbox: { s: 49.175, w: 37.215, n: 49.245, e: 37.325 },
    hint: "Спробуйте: «Я на станції Ізюм», «Я на Центральній площі», «Я біля церкви», «Рухаюсь до Сіверського Дінця», “I'm at Izium station”.",
    speechWords: ["hostile drone", "Track 2", "ворожий дрон", "свої", "об'єкт 2"],
    language: "uk",
    townAdminLevel: 8,
  },
};

/**
 * Report phrases in the speaker's own language, sent to speech-to-text ahead of the area's hints
 * when the speaker's pinned language is not the area's. The area's place names pull a clip
 * towards the area's language: on the Kyiv map, French said with Ukrainian came back in Cyrillic
 * or as made-up Ukrainian ("Je suis devant la mairie" as "Я сидів на мурі"), 6 clips of 6 [190].
 */
export const SPEAKER_PHRASES: Record<"en" | "fr" | "uk", string[]> = {
  en: ["I'm at", "I'm near", "next to", "in front of", "moving towards", "metres north", "the station", "the church", "the square", "the town hall"],
  fr: ["je suis à", "je suis devant", "près de", "à côté de", "je me dirige vers", "mètres au nord", "la gare", "l'église", "la place", "la mairie"],
  uk: ["я біля", "я на", "рухаюсь до", "навпроти", "поруч з", "метрів на північ", "станція метро", "церква", "площа", "вулиця"],
};

/** The hints for one report: the speaker's phrases first when their language is not the area's, then the area's, 100 at most. */
export function speechHints(area: Area, areaHints: string[], speaker: "en" | "fr" | "uk" | null): string[] {
  if (!speaker || speaker === area.language) return areaHints;
  return [...SPEAKER_PHRASES[speaker], ...areaHints].slice(0, 100);
}

/**
 * Place names in the offline Whisper prompt [246]. Ten fixed a real voice's "Château de Vonsen";
 * thirty did not, nor did the 100 Voxtral gets. Whisper reads only the end of a long prompt.
 */
export const WHISPER_PROMPT_PLACES = 10;
/** Call signs in the offline Whisper prompt, at most. */
const WHISPER_PROMPT_CALLSIGNS = 10;
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * The prompt for offline Whisper [246]: the roster's call signs, then the area's likeliest place
 * names, most useful first as `biasTerms` gives them, ending in a full stop. Whisper copies the
 * prompt's style: without the full stop it dropped the transcript's, and the local model then read
 * "Je suis à la mairie de Vincennes" as ambiguous. No report words: a prompt word can turn up in
 * the transcript, and "Track 2" there would be a track. null where the names are in Cyrillic:
 * with Izium's names, turbo wrote an English report in Cyrillic [195].
 */
export function whisperPrompt(roster: string[], places: string[]): string | null {
  const names = places.slice(0, WHISPER_PROMPT_PLACES);
  if (!names.length || names.some((n) => CYRILLIC.test(n))) return null;
  return `${[...roster.slice(0, WHISPER_PROMPT_CALLSIGNS), ...names].join(", ")}.`;
}

export const DEFAULT_AREA: AreaId = "vincennes";

export function isAreaId(x: unknown): x is AreaId {
  return typeof x === "string" && x in AREAS;
}
