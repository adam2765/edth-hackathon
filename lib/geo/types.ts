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
  | "north_east_of"
  | "south_east_of"
  | "south_west_of"
  | "north_west_of"
  | "towards"
  | "between";

/** Compass direction of travel, eight points. */
export type Direction = "north" | "north_east" | "east" | "south_east" | "south" | "south_west" | "west" | "north_west";

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
  /**
   * A distance the speaker stated, in metres. From the landmark when there is one ("200 metres
   * south of the church"), otherwise the distance moved ("moved 300 metres north").
   */
  distance_m?: number | null;
  /** The compass direction the speaker moved in, when said ("moved 300 metres north"). */
  direction?: Direction | null;
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
  /** The circle shown around this position, metres. A position worked out from it starts that unsure. */
  radius_m?: number;
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
  /** Set when the pin is worked out from the last position and a stated movement, not from a place. */
  estimated?: boolean;
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
  /** As in Placement: the pin is an estimate from the last position. */
  estimated?: boolean;
  candidates: Candidate[];
  /** Ask-back question (ambiguous) or prompt (unresolved). */
  question?: string;
  evidence: {
    rule: string;
    feature_id?: string;
    detail: string;
  };
}
