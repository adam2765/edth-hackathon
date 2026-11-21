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
    townAdminLevel: 8,
  },
};

export const DEFAULT_AREA: AreaId = "vincennes";

export function isAreaId(x: unknown): x is AreaId {
  return typeof x === "string" && x in AREAS;
}
