export type Category =
  | "church"
  | "metro_station"
  | "castle"
  | "town_hall"
  | "school"
  | "park"
  | "hospital"
  | "police"
  | "bridge"
  | "street"
  | "other";

export type Relation =
  | "at"
  | "near"
  | "in_front_of"
  | "behind"
  | "next_to"
  | "north_of"
  | "south_of"
  | "east_of"
  | "west_of"
  | "towards"
  | "between";

export interface GazetteerFeature {
  id: string;
  name: string;
  names: string[];
  category: Category;
  subtype?: string;
  lat: number;
  lon: number;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox?: [number, number, number, number];
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  /** Streets only: polylines as [lon, lat] pairs. */
  lines?: [number, number][][];
}

export interface Intent {
  kind: "position" | "movement" | "other";
  landmark_text: string | null;
  landmark_name: string | null;
  /**
   * landmark_name in dictionary (nominative) form, same script, for inflected languages:
   * "мостом Патона" → "міст Патона". Equal to landmark_name in English and French.
   */
  landmark_name_lemma?: string | null;
  landmark_category: Category | null;
  relation: Relation | null;
  language: "en" | "fr" | "uk";
  confidence: number;
}

export interface LastPosition {
  lat: number;
  lon: number;
  /** epoch ms */
  ts: number;
  /** Set when this position is an estimate from a movement report: how far off it may be, metres. */
  uncertainty_m?: number;
}

export interface HeadingTo {
  lat: number;
  lon: number;
  id: string;
  name: string;
}

/** Where the report puts the speaker if this candidate is the one meant. */
export interface Placement {
  /**
   * Absent for a movement with no known starting point. For a movement with one, this is an
   * estimate: the middle of the leg from the last position to `heading_to`.
   */
  pin?: { lat: number; lon: number };
  radius_m?: number;
  heading_to?: HeadingTo;
}

export interface Candidate {
  id: string;
  name: string;
  category: Category;
  subtype?: string;
  lat: number;
  lon: number;
  /** Distance from the reference point (last position or area centre), metres. */
  distance_m: number;
  score?: number;
  placement: Placement;
}

export interface Resolution {
  status: "resolved" | "ambiguous" | "unresolved";
  pin?: { lat: number; lon: number };
  radius_m?: number;
  heading_to?: HeadingTo;
  candidates: Candidate[];
  /** Ask-back question (ambiguous) or prompt (unresolved). */
  question?: string;
  evidence: {
    rule: string;
    feature_id?: string;
    detail: string;
  };
}
