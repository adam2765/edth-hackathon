import { describe, expect, it } from "vitest";
import { foldLog } from "../lib/reports/fold";
import { sightingGeometry } from "../lib/reports/sighting";
import type { Intent } from "../lib/geo/types";
import type { ReportEntry, TrackSighting } from "../lib/reports/types";

const T0 = Date.UTC(2026, 10, 28, 12, 0, 0);

function intent(extra: Partial<Intent> = {}): Intent {
  return {
    kind: "position",
    landmark_text: null,
    landmark_name: null,
    landmark_category: null,
    relation: null,
    distance_m: null,
    direction: null,
    language: "en",
    confidence: 0.9,
    ...extra,
  };
}

function sighting(extra: Partial<TrackSighting> = {}): TrackSighting {
  return {
    n: 1,
    affiliation: "unknown",
    kind: "vehicle",
    count: null,
    text: null,
    heading: null,
    position: { lat: 48.845, lon: 2.435, radius_m: 40, label: "the church" },
    from: { lat: 48.844, lon: 2.434 },
    ...extra,
  };
}

function entry(track: TrackSighting): ReportEntry {
  return {
    kind: "report",
    id: "r1",
    session: "demo",
    callsign: "ALPHA 1",
    seq: null,
    ts: T0,
    clientTs: null,
    area: "vincennes",
    transcript: "contact near the church",
    language: "en",
    intent: null,
    resolution: {
      status: "resolved",
      candidates: [],
      evidence: { rule: "test", detail: "" },
      track: { n: 1, opened: true, affiliation: "unknown", kind: "vehicle", count: null, text: null, heading: null },
    },
    lastPosition: null,
    position: null,
    track,
    timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 },
  };
}

describe("sighting geometry", () => {
  it("reads a stated bearing in degrees", () => {
    const g = sightingGeometry("bearing 060, 300 metres", intent(), { lat: 48.8, lon: 2.4, ts: T0, radius_m: 25 });
    expect(g.bearing_deg).toBe(60);
    expect(g.bearing_source).toBe("degrees");
    expect(g.from).toEqual({ lat: 48.8, lon: 2.4, radius_m: 25 });
  });

  it("reads a clock hour and falls back to the uncertainty for the radius", () => {
    const g = sightingGeometry("300 metres at 2 o'clock", intent(), { lat: 48.8, lon: 2.4, ts: T0, uncertainty_m: 18 });
    expect(g.bearing_deg).toBe(60);
    expect(g.bearing_source).toBe("clock");
    expect(g.from?.radius_m).toBe(18);
  });

  it("keeps the compass bin when no exact angle was said", () => {
    const g = sightingGeometry("enemy vehicle north of the church", intent({ direction: "north" }), null);
    expect(g.bearing_deg).toBe(0);
    expect(g.bearing_source).toBe("compass8");
    expect(g.from).toBeNull();
  });
});

describe("the track log stays readable", () => {
  it("re-reads an old sighting with only lat and lon", () => {
    const state = foldLog([entry(sighting())]);
    const from = state.tracks[0].from;
    expect(from).toEqual({ lat: 48.844, lon: 2.434 });
    expect(from?.radius_m).toBeUndefined();
    expect(from?.bearing_deg).toBeUndefined();
  });

  it("keeps the observer radius and bearing on a new sighting", () => {
    const state = foldLog([
      entry(sighting({ from: { lat: 48.844, lon: 2.434, radius_m: 12 }, bearing_deg: 60, bearing_source: "degrees" })),
    ]);
    expect(state.tracks[0].from).toEqual({ lat: 48.844, lon: 2.434, radius_m: 12, bearing_deg: 60, bearing_source: "degrees" });
  });
});
