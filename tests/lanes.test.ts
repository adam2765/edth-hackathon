import { describe, expect, it } from "vitest";
import type { Affiliation, TrackKind } from "../lib/geo/types";
import {
  DEFAULT_TRACK_VIEW,
  anchorFor,
  arrangeTracks,
  laneState,
  moveNextTo,
  parseOrders,
  parseTrackView,
  previewMove,
  withSaved,
  type LaneTrack,
  type TrackView,
} from "../lib/reports/lanes";

const at = { lat: 48.85, lon: 2.44 };
function track(n: number, affiliation: Affiliation, kind: TrackKind, seenTs: number, more: Partial<LaneTrack> = {}): LaneTrack {
  return { n, affiliation, kind, seenTs, gone: null, pendingReport: null, position: at, ...more };
}

// T1 hostile vehicle, T2 friendly drone (newest), T3 unknown people not placed, T4 hostile armour gone,
// T5 civilian vehicle seen long ago, T6 suspect people whose place waits for an answer.
const tracks: LaneTrack[] = [
  track(1, "hostile", "vehicle", 100),
  track(2, "friendly", "drone", 600),
  track(3, "unknown", "people", 300, { position: null }),
  track(4, "hostile", "armour", 500, { gone: 550 }),
  track(5, "neutral", "vehicle", 10),
  track(6, "suspect", "people", 400, { pendingReport: "r6" }),
];
const isOld = (t: LaneTrack) => t.seenTs < 50;
const view = (v: Partial<TrackView>): TrackView => ({ ...DEFAULT_TRACK_VIEW, ...v });
const numbers = (r: ReturnType<typeof arrangeTracks<LaneTrack>>) => r.sections.map((s) => [s.id, s.tracks.map((t) => t.n)]);

describe("the order a person left", () => {
  it("keeps the base order when nothing is saved", () => {
    expect(withSaved([1, 2, 3], [])).toEqual([1, 2, 3]);
    expect(withSaved([1, 2, 3], null)).toEqual([1, 2, 3]);
  });

  it("puts new keys first, then the saved ones still here", () => {
    expect(withSaved([1, 2, 3, 4], [3, 1, 9, 2])).toEqual([4, 3, 1, 2]);
  });

  it("moves a key next to another", () => {
    expect(moveNextTo([1, 2, 3, 4], 4, 2, "before")).toEqual([1, 4, 2, 3]);
    expect(moveNextTo([1, 2, 3, 4], 1, 3, "after")).toEqual([2, 3, 1, 4]);
    expect(moveNextTo([1, 2, 3], 2, 2, "after")).toEqual([1, 2, 3]);
    expect(moveNextTo([1, 2, 3], 7, 2, "after")).toEqual([1, 2, 3]);
  });

  it("finds the neighbour a dragged strip lands next to", () => {
    expect(anchorFor(["a", "b", "c"], "a", 1)).toEqual({ anchor: "c", side: "before" });
    expect(anchorFor(["a", "b", "c"], "a", 2)).toEqual({ anchor: "c", side: "after" });
    expect(anchorFor(["a", "b", "c"], "c", 0)).toEqual({ anchor: "a", side: "before" });
    expect(anchorFor(["a"], "a", 0)).toBeNull();
    expect(previewMove(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });

  it("reads a broken or foreign saved value as nothing saved", () => {
    expect(parseOrders(null)).toEqual({ units: [], tracks: [] });
    expect(parseOrders("{")).toEqual({ units: [], tracks: [] });
    expect(parseOrders(JSON.stringify({ units: ["ALPHA", 3], tracks: [2, "x", 1.5, 1] }))).toEqual({ units: ["ALPHA"], tracks: [2, 1] });
    expect(parseTrackView(JSON.stringify({ sort: "nearest", group: "kind", hide: ["gone", "target"] }))).toEqual({ sort: "number", group: "kind", hide: ["gone"] });
  });
});

describe("the tracks' sort, groups and filter", () => {
  it("shows a track's state in the pill's order", () => {
    expect(laneState(tracks[3], true)).toBe("gone");
    expect(laneState(tracks[5], true)).toBe("ask");
    expect(laneState(tracks[4], true)).toBe("old");
    expect(laneState(tracks[2], false)).toBe("unplaced");
    expect(laneState(tracks[0], false)).toBe("placed");
  });

  it("sorts by number with gone tracks last, as before", () => {
    const r = arrangeTracks(tracks, DEFAULT_TRACK_VIEW, null, isOld);
    expect(numbers(r)).toEqual([["all", [1, 2, 3, 5, 6, 4]]]);
    expect(r.order).toEqual([1, 2, 3, 5, 6, 4]);
    expect(r.hidden).toBe(0);
  });

  it("sorts by last seen, whose and kind, by number on a tie", () => {
    expect(numbers(arrangeTracks(tracks, view({ sort: "seen" }), null, isOld))).toEqual([["all", [2, 6, 3, 1, 5, 4]]]);
    expect(numbers(arrangeTracks(tracks, view({ sort: "whose" }), null, isOld))).toEqual([["all", [1, 6, 3, 5, 2, 4]]]);
    expect(numbers(arrangeTracks(tracks, view({ sort: "kind" }), null, isOld))).toEqual([["all", [3, 6, 1, 5, 2, 4]]]);
  });

  it("keeps the order a person dragged, a new track first", () => {
    expect(numbers(arrangeTracks(tracks, view({ sort: "mine" }), [6, 5, 3, 2, 1, 4], isOld))).toEqual([["all", [6, 5, 3, 2, 1, 4]]]);
    const fresh = [...tracks, track(7, "unknown", "jammer", 700)];
    expect(numbers(arrangeTracks(fresh, view({ sort: "mine" }), [6, 5, 3, 2, 1, 4], isOld))).toEqual([["all", [7, 6, 5, 3, 2, 1, 4]]]);
  });

  it("groups in the fixed list order and leaves out empty groups", () => {
    expect(numbers(arrangeTracks(tracks, view({ group: "whose" }), null, isOld))).toEqual([
      ["hostile", [1, 4]],
      ["suspect", [6]],
      ["unknown", [3]],
      ["neutral", [5]],
      ["friendly", [2]],
    ]);
    const byState = arrangeTracks(tracks, view({ group: "state", sort: "seen" }), null, isOld);
    expect(numbers(byState)).toEqual([
      ["ask", [6]],
      ["placed", [2, 1]],
      ["unplaced", [3]],
      ["old", [5]],
      ["gone", [4]],
    ]);
    expect(byState.sections.map((s) => s.label)).toEqual(["Awaiting answer", "On the map", "Not placed", "Old sightings", "Gone"]);
    expect(byState.order).toEqual([6, 2, 1, 3, 5, 4]);
  });

  it("hides by whose, gone and old, and counts what it hides", () => {
    const r = arrangeTracks(tracks, view({ hide: ["hostile", "gone", "old"] }), null, isOld);
    expect(numbers(r)).toEqual([["all", [2, 3, 6]]]);
    expect(r.hidden).toBe(3);
    // A hidden track keeps its place in the order, so showing it again puts it back where it was.
    expect(r.order).toEqual([1, 2, 3, 5, 6, 4]);
  });

  it("drops a group the filter empties", () => {
    const r = arrangeTracks(tracks, view({ group: "whose", hide: ["neutral"] }), null, isOld);
    expect(r.sections.map((s) => s.id)).toEqual(["hostile", "suspect", "unknown", "friendly"]);
  });
});
