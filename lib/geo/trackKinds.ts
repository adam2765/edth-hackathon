/**
 * How a track is named and drawn: the fixed lists, the command post's words, and the standard
 * symbol for each kind. No imports beyond types, so the command post can use it without the resolver.
 */
import type { Affiliation, Direction, TrackKind } from "./types";

export const AFFILIATIONS: Affiliation[] = ["hostile", "suspect", "unknown", "neutral", "friendly"];
export const TRACK_KINDS: TrackKind[] = ["people", "vehicle", "armour", "drone", "drone_team", "mortar", "artillery", "jammer", "other"];

/** The command post's words for whose a track is. */
export const AFFILIATION_LABEL: Record<Affiliation, string> = { hostile: "Hostile", suspect: "Suspect", unknown: "Unknown", neutral: "Civilian", friendly: "Friendly" };
const KIND_LABEL: Record<TrackKind, string> = { people: "people", vehicle: "vehicle", armour: "armour", drone: "drone", drone_team: "drone team", mortar: "mortar", artillery: "artillery", jammer: "jammer", other: "" };
/** Each kind's name on a button, where "other" has to be written out. */
export const TRACK_KIND_NAME: Record<TrackKind, string> = { people: "People", vehicle: "Vehicle", armour: "Armour", drone: "Drone", drone_team: "Drone team", mortar: "Mortar", artillery: "Artillery", jammer: "Jammer", other: "Other" };

/** "hostile vehicle ×2", for the map and the lists. The kind is written out: its small icon is hard to read from across a room. */
export function describeTrack(t: { affiliation: Affiliation; kind: TrackKind; count: number | null }): string {
  const words = [AFFILIATION_LABEL[t.affiliation].toLowerCase(), KIND_LABEL[t.kind]].filter(Boolean).join(" ");
  return t.count && t.count > 1 ? `${words} ×${t.count}` : words;
}

/** The colour of a track's circle and trail on the light map; the symbol's own frame carries the standard colour. */
export const AFFILIATION_COLOUR: Record<Affiliation, string> = { hostile: "#c92a2a", suspect: "#c92a2a", unknown: "#8a6a00", neutral: "#15803d", friendly: "#0b63b0" };

const IDENTITY: Record<Affiliation, string> = { hostile: "H", suspect: "S", unknown: "U", neutral: "N", friendly: "F" };
/** Battle dimension and function, in the letter codes of APP-6 and MIL-STD-2525C. */
const SYMBOL: Record<TrackKind, [dimension: string, fn: string]> = {
  people: ["G", "UCI---"],
  vehicle: ["G", "EV----"],
  armour: ["G", "UCA---"],
  drone: ["A", "MFQ---"],
  drone_team: ["G", "UCVU--"],
  mortar: ["G", "UCFM--"],
  artillery: ["G", "UCF---"],
  jammer: ["G", "UUMSEJ"],
  other: ["G", "------"],
};

/**
 * The standard symbol code for a track (APP-6, letter form), drawn by milsymbol on the command post.
 * The frame says whose it is, the icon what it is. A civilian thing gets a civilian vehicle or an
 * empty frame, never a military icon. The table is the only place a symbol is chosen: the model
 * names a kind from the fixed list and never a code.
 */
export function trackSymbolCode(affiliation: Affiliation, kind: TrackKind): string {
  let [dimension, fn] = SYMBOL[kind];
  if (affiliation === "neutral") [dimension, fn] = kind === "vehicle" ? ["G", "EVC---"] : kind === "drone" ? ["A", "------"] : ["G", "------"];
  return `S${IDENTITY[affiliation]}${dimension}P${fn}-----`;
}

/** A compass word as a bearing, for the arrow that shows which way a track was said to be moving. */
export const HEADING_DEG: Record<Direction, number> = { north: 0, north_east: 45, east: 90, south_east: 135, south: 180, south_west: 225, west: 270, north_west: 315 };
