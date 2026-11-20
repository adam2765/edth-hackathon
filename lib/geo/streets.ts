/**
 * Street pieces that share a name are not always one street: Vincennes and Montreuil each have
 * a "rue Gambetta". The gazetteer build groups pieces by name, then by distance and town, so
 * streets far apart stay separate features and a report naming one is asked back.
 */

type Line = [number, number][];

/** Pieces this close are one street, whatever town they are in (a street broken by a junction or a square). */
export const STREET_JOIN_M = 150;
/** In one town, pieces this close are still one street: a town does not give two streets the same name. */
export const SAME_TOWN_JOIN_M = 1000;

const toRad = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

/** Shortest distance between two polylines ([lon, lat] pairs), metres; flat projection, fine at city scale. */
export function lineGapM(a: Line, b: Line): number {
  const kx = Math.cos(a[0][1] * toRad);
  const xy = (p: [number, number]): [number, number] => [p[0] * kx * M_PER_DEG_LAT, p[1] * M_PER_DEG_LAT];
  const A = a.map(xy);
  const B = b.map(xy);
  let best = Infinity;
  const pointToLine = (p: [number, number], line: [number, number][]) => {
    for (let i = 0; i < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = i + 1 < line.length ? line[i + 1] : line[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
      const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
      if (d < best) best = d;
    }
  };
  for (const p of A) pointToLine(p, B);
  for (const p of B) pointToLine(p, A);
  return best;
}

/** Shortest distance between two sets of polylines, metres. */
export function linesGapM(a: Line[], b: Line[]): number {
  let best = Infinity;
  for (const x of a) for (const y of b) best = Math.min(best, lineGapM(x, y));
  return best;
}

/** Splits items into groups where linked items share a group, directly or through others. Keeps first-seen order. */
export function linkGroups<T>(items: T[], linked: (a: T, b: T) => boolean): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) !== find(j) && linked(items[i], items[j])) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), item]);
  });
  return [...groups.values()];
}

/** First pass: pieces of one name within STREET_JOIN_M of each other are one street. Returns groups of piece indexes. */
export function groupStreetPieces(lines: Line[], joinM = STREET_JOIN_M): number[][] {
  return linkGroups(
    lines.map((_, i) => i),
    (i, j) => lineGapM(lines[i], lines[j]) <= joinM,
  );
}

/**
 * Second pass, once each group's town is known: groups in the same town within SAME_TOWN_JOIN_M
 * are one street. Groups with no town are never joined this way. Returns groups of group indexes.
 */
export function joinSameTown(groups: { lines: Line[]; town?: string }[], maxGapM = SAME_TOWN_JOIN_M): number[][] {
  return linkGroups(
    groups.map((_, i) => i),
    (i, j) => !!groups[i].town && groups[i].town === groups[j].town && linesGapM(groups[i].lines, groups[j].lines) <= maxGapM,
  );
}
