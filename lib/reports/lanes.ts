/**
 * The order of the command post's two lanes, units and tracks, on this screen only [259]: the order
 * a person dragged the strips into, and for the tracks a sort, groups and a filter. Pure; safe on the
 * client. Nothing here changes a unit or a track, and nothing ranks them: every order is a number, a
 * time, a fixed list or a person's own (decision 234).
 */
import type { Affiliation, TrackKind } from "../geo/types";
import { AFFILIATIONS, AFFILIATION_LABEL, TRACK_KINDS, TRACK_KIND_NAME } from "../geo/trackKinds";

/** How the tracks are ordered: the order a person left them in, by number, by last seen, by whose or by kind. */
export type TrackSort = "mine" | "number" | "seen" | "whose" | "kind";
/** How the tracks are grouped under headings. */
export type TrackGroup = "none" | "whose" | "kind" | "state";
/** What a strip's pill says about a track, as one word. */
export type TrackLaneState = "ask" | "placed" | "unplaced" | "old" | "gone";
/** What the filter can hide: one affiliation, the tracks marked gone, or the old sightings. */
export type TrackHide = Affiliation | "gone" | "old";

export interface TrackView {
  sort: TrackSort;
  group: TrackGroup;
  hide: TrackHide[];
}

/** Today's list: by number, no groups, nothing hidden. */
export const DEFAULT_TRACK_VIEW: TrackView = { sort: "number", group: "none", hide: [] };

export const TRACK_SORTS: { id: TrackSort; label: string }[] = [
  { id: "number", label: "Number" },
  { id: "seen", label: "Last seen" },
  { id: "whose", label: "Whose" },
  { id: "kind", label: "Kind" },
  { id: "mine", label: "My order" },
];

export const TRACK_GROUPS: { id: TrackGroup; label: string }[] = [
  { id: "none", label: "None" },
  { id: "whose", label: "Whose" },
  { id: "kind", label: "Kind" },
  { id: "state", label: "State" },
];

const STATES: TrackLaneState[] = ["ask", "placed", "unplaced", "old", "gone"];
/** The group headings for each state, in the strips' own words. */
export const STATE_LABEL: Record<TrackLaneState, string> = {
  ask: "Awaiting answer",
  placed: "On the map",
  unplaced: "Not placed",
  old: "Old sightings",
  gone: "Gone",
};

/** The filter's chips, in the order they show. */
export const TRACK_HIDES: { id: TrackHide; label: string }[] = [
  ...AFFILIATIONS.map((a) => ({ id: a, label: AFFILIATION_LABEL[a] })),
  { id: "old", label: STATE_LABEL.old },
  { id: "gone", label: STATE_LABEL.gone },
];

/** The fields of a track this file reads. */
export interface LaneTrack {
  n: number;
  affiliation: Affiliation;
  kind: TrackKind;
  seenTs: number;
  gone: number | null;
  pendingReport: string | null;
  position: unknown;
}

/** The state a strip's pill shows, checked in the same order as the pill: gone, then a question, then old. */
export function laneState(t: LaneTrack, old: boolean): TrackLaneState {
  if (t.gone != null) return "gone";
  if (t.pendingReport) return "ask";
  if (old) return "old";
  return t.position ? "placed" : "unplaced";
}

/**
 * Keys in the order a person left them. Ones that came after that go first, so a new track or unit
 * is seen; then the saved ones still here. With nothing saved, the base order as it is.
 */
export function withSaved<K>(base: K[], saved: readonly K[] | null | undefined): K[] {
  if (!saved?.length) return base;
  const here = new Set(base);
  const kept = saved.filter((k) => here.has(k));
  const known = new Set(kept);
  return [...base.filter((k) => !known.has(k)), ...kept];
}

/** `order` with `key` taken out and put just before or just after `anchor`. */
export function moveNextTo<K>(order: readonly K[], key: K, anchor: K, side: "before" | "after"): K[] {
  if (key === anchor || !order.includes(key)) return [...order];
  const rest = order.filter((k) => k !== key);
  const i = rest.indexOf(anchor);
  if (i < 0) return [...order];
  rest.splice(side === "before" ? i : i + 1, 0, key);
  return rest;
}

/** One heading and its tracks; `id` "all" and no label when the list has no groups. */
export interface TrackSection<T> {
  id: string;
  label: string | null;
  tracks: T[];
}

export interface ArrangedTracks<T> {
  sections: TrackSection<T>[];
  /** Every track's number in the order shown, hidden ones included: what a move starts from. */
  order: number[];
  /** How many the filter hides. */
  hidden: number;
}

function groupOf(t: LaneTrack, group: TrackGroup, state: TrackLaneState): string {
  return group === "whose" ? t.affiliation : group === "kind" ? t.kind : group === "state" ? state : "all";
}

function groupIds(group: TrackGroup): string[] {
  return group === "whose" ? AFFILIATIONS : group === "kind" ? TRACK_KINDS : group === "state" ? STATES : ["all"];
}

function groupLabel(group: TrackGroup, id: string): string | null {
  if (group === "whose") return AFFILIATION_LABEL[id as Affiliation];
  if (group === "kind") return TRACK_KIND_NAME[id as TrackKind];
  if (group === "state") return STATE_LABEL[id as TrackLaneState];
  return null;
}

/**
 * The tracks as the list shows them: sorted, grouped and filtered. Gone tracks go last in every
 * sort, as before: they are off the map and kept for the record. `mine` is the order a person
 * dragged, used when the sort is "mine".
 */
export function arrangeTracks<T extends LaneTrack>(tracks: readonly T[], view: TrackView, mine: readonly number[] | null, isOld: (t: T) => boolean): ArrangedTracks<T> {
  const state = new Map(tracks.map((t) => [t.n, laneState(t, isOld(t))]));
  const byNumber = [...tracks].sort((a, b) => a.n - b.n);
  const place = new Map(withSaved(byNumber.map((t) => t.n), mine).map((n, i) => [n, i]));
  const rank = (t: T): number => {
    if (view.sort === "whose") return AFFILIATIONS.indexOf(t.affiliation);
    if (view.sort === "kind") return TRACK_KINDS.indexOf(t.kind);
    if (view.sort === "seen") return -t.seenTs;
    if (view.sort === "mine") return place.get(t.n) ?? 0;
    return 0;
  };
  const sorted = byNumber.sort((a, b) => Number(a.gone != null) - Number(b.gone != null) || rank(a) - rank(b) || a.n - b.n);

  const groups = new Map<string, T[]>(groupIds(view.group).map((id) => [id, []]));
  for (const t of sorted) groups.get(groupOf(t, view.group, state.get(t.n)!))?.push(t);

  const hide = new Set(view.hide);
  const shown = (t: T): boolean => {
    const s = state.get(t.n)!;
    return !hide.has(t.affiliation) && !(s === "gone" && hide.has("gone")) && !(s === "old" && hide.has("old"));
  };

  const sections: TrackSection<T>[] = [];
  const order: number[] = [];
  let hidden = 0;
  for (const [id, list] of groups) {
    order.push(...list.map((t) => t.n));
    const visible = list.filter(shown);
    hidden += list.length - visible.length;
    if (visible.length) sections.push({ id, label: groupLabel(view.group, id), tracks: visible });
  }
  return { sections, order, hidden };
}

/**
 * Where a strip lands when it is moved within its own list, as a move next to a neighbour: the one
 * now after it, or the one now before it at the end. Null when it has no neighbour to move past.
 */
export function anchorFor<K>(list: readonly K[], key: K, to: number): { anchor: K; side: "before" | "after" } | null {
  const rest = list.filter((k) => k !== key);
  if (!rest.length || !list.includes(key)) return null;
  const i = Math.max(0, Math.min(rest.length, to));
  return i < rest.length ? { anchor: rest[i], side: "before" } : { anchor: rest[rest.length - 1], side: "after" };
}

/** A list with one key moved to index `to` among the others: the preview while a strip is dragged. */
export function previewMove<K>(list: readonly K[], key: K, to: number): K[] {
  if (!list.includes(key)) return [...list];
  const rest = list.filter((k) => k !== key);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, key);
  return rest;
}

/** The saved order for each lane of one mission. */
export interface LaneOrders {
  units: string[];
  tracks: number[];
}

/** Reads a saved order; anything unexpected reads as nothing saved. */
export function parseOrders(raw: string | null): LaneOrders {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<LaneOrders>) : null;
    return {
      units: Array.isArray(v?.units) ? v.units.filter((k): k is string => typeof k === "string") : [],
      tracks: Array.isArray(v?.tracks) ? v.tracks.filter((k): k is number => Number.isInteger(k)) : [],
    };
  } catch {
    return { units: [], tracks: [] };
  }
}

/** Reads the saved sort, groups and filter; anything unexpected reads as the default. */
export function parseTrackView(raw: string | null): TrackView {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<TrackView>) : null;
    const hides = new Set<string>(TRACK_HIDES.map((h) => h.id));
    return {
      sort: TRACK_SORTS.some((s) => s.id === v?.sort) ? v!.sort! : DEFAULT_TRACK_VIEW.sort,
      group: TRACK_GROUPS.some((g) => g.id === v?.group) ? v!.group! : DEFAULT_TRACK_VIEW.group,
      hide: Array.isArray(v?.hide) ? v.hide.filter((h): h is TrackHide => typeof h === "string" && hides.has(h)) : [],
    };
  } catch {
    return DEFAULT_TRACK_VIEW;
  }
}
