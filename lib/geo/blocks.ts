/**
 * Counting blocks: "two blocks east", "deux rues plus loin à l'est", "два квартали на схід".
 * The count is read from the words, here in code; the model gives no distance for it [51]. The
 * crossings come from the street lines, as for "the next crossing" [117]. Pure.
 */
import { angleBetween, CROSSING_CLUSTER_M, streetAxisAt, type Crossing } from "./crossings";
import { bearingDeg, distanceM, nearestPointOnLines, type LatLon } from "./geo";
import { tokens } from "./normalize";
import type { GazetteerFeature } from "./types";

/** More blocks than this are not counted: the app asks how far instead. */
export const MAX_BLOCKS = 6;
/** Crossings are counted this far along the street. */
export const BLOCK_REACH_M = 1500;
/** A street runs the way said when its axis is within this angle of it. */
export const RUNS_WAY_DEG = 45;
/** A crossing is ahead when it lies within this angle of the way said, seen from the start. */
const AHEAD_DEG = 60;
/** A crossing this close to the start is where the count starts, not the first block. */
const AT_START_M = 20;

/** Always a block, with or without a count: "two blocks", "un pâté de maisons", "квартал". */
const BLOCK_WORDS = new Set(["block", "blocks", "bloc", "blocs", "pate", "pates"]);
const BLOCK_STEMS = ["квартал"];
/** A block only with a count in front: "two streets east", "deux rues", "дві вулиці", "two crossings". */
const COUNTED_WORDS = new Set(["street", "streets", "crossing", "crossings", "intersection", "intersections", "junction", "junctions", "rue", "rues", "carrefour", "carrefours", "croisement", "croisements"]);
const COUNTED_STEMS = ["вулиц", "перехрест", "улиц", "перекрест"];
/** Singular street words count only one: "12 rue de Fontenay" is an address, not twelve streets. */
const SINGULAR = new Set(["street", "crossing", "intersection", "junction", "rue", "carrefour", "croisement"]);

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
  один: 1, одна: 1, одну: 1, одного: 1, два: 2, дві: 2, двох: 2, двух: 2, три: 3, трьох: 3, трех: 3, трёх: 3,
  чотири: 4, чотирьох: 4, четыре: 4, четырех: 4, четырёх: 4, пять: 5, пяти: 5, пятьох: 5, шість: 6, шесть: 6,
};
/** Before a street word these are articles, not a count: "on a street east of the castle", "une rue". */
const ARTICLES = new Set(["a", "an", "un", "une"]);
/** Said instead of a count: "a few blocks", "quelques rues", "кілька кварталів". */
const VAGUE = new Set(["few", "several", "some", "many", "quelques", "plusieurs", "кілька", "декілька", "несколько", "пару"]);

export interface BlocksSaid {
  /** How many blocks; null for "a few blocks", which is no count. */
  n: number | null;
}

/**
 * The blocks a report counts, or null when it counts none. "Road block" and "rue de Fontenay"
 * count nothing: a block word needs a count or a word such as "few" in front, and a street word a count.
 */
export function blocksSaid(transcript: string): BlocksSaid | null {
  const toks = tokens(transcript);
  for (const [i, t] of toks.entries()) {
    const block = BLOCK_WORDS.has(t) || BLOCK_STEMS.some((s) => t.startsWith(s));
    const counted = COUNTED_WORDS.has(t) || COUNTED_STEMS.some((s) => t.startsWith(s));
    if (!block && !counted) continue;
    // "a couple of blocks": skip the "of".
    let j = i - 1;
    if (toks[j] === "of" && j > 0) j--;
    const before = toks[j];
    if (before == null || (!block && ARTICLES.has(before))) continue;
    const n = /^\d{1,2}$/.test(before) ? Number(before) : NUMBERS[before];
    if (n != null && !(SINGULAR.has(t) && n !== 1)) return { n };
    if (block && VAGUE.has(before)) return { n: null };
  }
  return null;
}

/** Does the street run the way said, at the point on it nearest `p`? */
export function runsWay(street: GazetteerFeature, p: LatLon, bearing: number): boolean {
  const axis = street.lines?.length ? streetAxisAt(p, street.lines) : null;
  return axis != null && Math.min(angleBetween(axis, bearing), angleBetween(axis + 180, bearing)) <= RUNS_WAY_DEG;
}

export interface Ahead {
  c: Crossing;
  /** Metres from the start. */
  dist: number;
}

/**
 * Does a street cross this one right through, with a part on each side? Two streets meeting from
 * opposite sides under different names count: "Rue de Colmar / Rue des Vignerons". A street that
 * only joins from one side, or a lane that ends there, does not.
 */
export function crossesThrough(c: Crossing, along: GazetteerFeature, byId: Map<string, GazetteerFeature>): boolean {
  const axis = streetAxisAt(c, along.lines ?? []);
  if (axis == null) return false;
  const sides = new Set<number>();
  for (const id of c.streets) {
    if (id === along.id) continue;
    for (const line of byId.get(id)?.lines ?? []) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = { lon: line[i][0], lat: line[i][1] };
        const b = { lon: line[i + 1][0], lat: line[i + 1][1] };
        if (distanceM(c, nearestPointOnLines(c, [[line[i], line[i + 1]]])) > CROSSING_CLUSTER_M) continue;
        for (const p of [a, b]) {
          if (distanceM(c, p) < 5) continue;
          const s = Math.sin(((bearingDeg(c, p) - axis) * Math.PI) / 180);
          // A part running along this street is not a side.
          if (Math.abs(s) > 0.3) sides.add(Math.sign(s));
        }
      }
    }
  }
  return sides.size === 2;
}

/**
 * The crossings on `along` ahead of `start` the way said, nearest first: every one, and the ones a
 * street crosses right through. "Two blocks" is the second of one list or the other.
 */
export function crossingsAhead(
  along: GazetteerFeature,
  start: LatLon,
  bearing: number,
  crossings: Crossing[],
  byId: Map<string, GazetteerFeature>,
): { every: Ahead[]; through: Ahead[] } {
  const every = crossings
    .filter((c) => c.streets.includes(along.id))
    .map((c) => ({ c, dist: distanceM(start, c), way: bearingDeg(start, c) }))
    .filter((x) => x.dist > AT_START_M && x.dist <= BLOCK_REACH_M && angleBetween(x.way, bearing) <= AHEAD_DEG)
    .sort((a, b) => a.dist - b.dist)
    .map(({ c, dist }) => ({ c, dist }));
  return { every, through: every.filter((x) => crossesThrough(x.c, along, byId)) };
}
