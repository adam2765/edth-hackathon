/** Areas the app can work in. Each has its own committed gazetteer file. Safe to import on the client. */
export type AreaId = "vincennes" | "kyiv";

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
  },
};

export const DEFAULT_AREA: AreaId = "vincennes";

export function isAreaId(x: unknown): x is AreaId {
  return typeof x === "string" && x in AREAS;
}
