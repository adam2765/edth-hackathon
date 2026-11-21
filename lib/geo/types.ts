export type Category =
  | "church"
  | "metro_station"
  | "castle"
  | "town_hall"
  | "school"
  | "park"
  | "cemetery"
  | "hospital"
  | "police"
  | "bridge"
  | "street"
  /** Bus, tram and trolleybus stops. */
  | "stop"
  | "fuel"
  | "pharmacy"
  | "hotel"
  /** Rivers, canals, lakes and ponds. */
  | "water"
  /** A named building that is none of the above. */
  | "building"
  /** Where streets meet. Not in the gazetteer: worked out from the street lines (lib/geo/crossings.ts). */
  | "intersection"
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

/**
 * Whose a track is, as the speaker said it. Worked out in code from the words, never by the model
 * (lib/geo/tracks.ts). `suspect` is a track thought to be hostile and still to be looked into.
 * `unknown` when no word for it was said.
 */
export type Affiliation = "hostile" | "suspect" | "unknown" | "neutral" | "friendly";

/** What kind of thing a track is. A fixed list: code maps each kind to a standard symbol. */
export type TrackKind = "people" | "vehicle" | "armour" | "drone" | "drone_team" | "mortar" | "artillery" | "jammer" | "other";

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
  /** Streets and rivers: polylines as [lon, lat] pairs. */
  lines?: [number, number][][];
  /** Set when another street in the gazetteer has the same name: the town this one is in, to tell them apart. */
  town?: string;
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
  /**
   * Who the report is about: the speaker, or a track, something else the speaker sees or knows of.
   * Absent means the speaker. The model's reading is checked against the words in code.
   * For a track, the landmark, relation, distance and direction say where the track is.
   */
  subject?: "self" | "track";
  /** The number of a track the speaker named ("Track 3"). */
  track_ref?: number | null;
  /** The kind of thing, from a type word the speaker said ("vehicle", "drone"). */
  track_kind?: TrackKind | null;
  /** How many, when said ("two vehicles"). */
  track_count?: number | null;
  /** The thing as said, without the place ("two armoured vehicles"). */
  track_text?: string | null;
  /** The compass direction the track itself is moving in, when said. */
  track_heading?: Direction | null;
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
  /**
   * The gazetteer id of the street the unit is on or moving along, when its latest placement named
   * one. Kept through a crossing on that street. Set by the coordinator, never by the phone.
   */
  street?: string;
  /** The bearing the unit moved on from its previous fix to this one, degrees. Set by the coordinator. */
  heading_deg?: number;
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
  /** As in GazetteerFeature: the town, when another street has the same name. */
  town?: string;
  score?: number;
  /** A crossing: the ids of the streets that meet there. */
  streets?: string[];
  /** Where the report puts the speaker if this candidate is meant. Empty for a report about a track. */
  placement: Placement;
  /** For a report about a track: where the track is if this candidate is meant. */
  track_placement?: Placement;
}

/** What a report says about a track: a new one, or one the speaker named by its number. */
export interface TrackResolution {
  /** The track's number: the one named, or the one given when the report is saved. Null until then. */
  n: number | null;
  /** True when the report opens a track; false when it adds to one the speaker named. */
  opened: boolean;
  /** From the speaker's words; null when none said whose it is. A new track is then `unknown`. */
  affiliation: Affiliation | null;
  kind: TrackKind | null;
  count: number | null;
  /** The thing as said. */
  text: string | null;
  /** The way the track is moving, as said. */
  heading: Direction | null;
  /**
   * Where the track is, when the report settles that. Absent while a question is open, and when
   * the report only says what the track is ("Track 3 is hostile").
   */
  placement?: Placement;
  /** What it was placed at, for the map and the lists ("Mairie de Vincennes", "300 m north of ALPHA 1"). */
  label?: string;
  /** What to say back to the speaker, in their language: "Track 3, unknown vehicle, Mairie de Vincennes." */
  say?: string;
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
  /**
   * Set when the report is about a track. `pin`, `radius_m` and every candidate's `placement` are
   * then empty: a report about a track never moves the speaker.
   */
  track?: TrackResolution;
  evidence: {
    rule: string;
    feature_id?: string;
    detail: string;
  };
}
