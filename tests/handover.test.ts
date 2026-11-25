import { describe, expect, it } from "vitest";
import type { FeedItem, SessionState, TrackState, UnitState } from "@/lib/reports/fold";
import { handover } from "@/lib/reports/handover";
import type { UnitPosition } from "@/lib/reports/types";

const at: UnitPosition = { lat: 48.844, lon: 2.432, radius_m: 50, label: "Mairie de Vincennes" };

function unit(over: Partial<UnitState> = {}): UnitState {
  return {
    callsign: "ALPHA 1",
    colour: "#ff6b2c",
    area: "vincennes",
    position: at,
    positionTs: 1000,
    trail: [],
    lastHeard: 1000,
    pending: null,
    joined: 900,
    device: null,
    atStart: false,
    street: null,
    kind: null,
    task: null,
    prompt: null,
    placedBy: null,
    ...over,
  };
}

function track(over: Partial<TrackState> = {}): TrackState {
  return {
    n: 1,
    affiliation: "unknown",
    kind: "vehicle",
    count: 1,
    text: null,
    heading: null,
    area: "vincennes",
    position: at,
    positionTs: 1000,
    trail: [],
    seenBy: "ALPHA 1",
    seenTs: 1000,
    from: null,
    openedBy: "ALPHA 1",
    openedTs: 1000,
    pendingReport: null,
    plotted: false,
    changed: null,
    note: null,
    gone: null,
    task: null,
    recon: [],
    ...over,
  };
}

function feed(over: Partial<FeedItem> = {}): FeedItem {
  return {
    kind: "report",
    id: "f1",
    ts: 1000,
    callsign: "ALPHA 1",
    colour: "#ff6b2c",
    area: "vincennes",
    transcript: "at the town hall",
    status: "resolved",
    outcome: "Mairie de Vincennes",
    position: at,
    track: null,
    candidates: [],
    answer: null,
    expired: false,
    ...over,
  };
}

function view(over: Partial<SessionState> = {}): SessionState {
  return {
    mission: { name: "Vincennes test", area: "vincennes", start: null, opened: 0, ended: null },
    units: [],
    roster: [],
    held: [],
    requests: [],
    tracks: [],
    feed: [],
    first: null,
    last: null,
    area: "vincennes",
    ...over,
  };
}

const fmt = () => "09:00";

describe("handover", () => {
  it("says when there is nothing to report", () => {
    const said = handover(view(), { session: "test-1", now: 1000, mode: "live", format: fmt });
    expect(said).toContain("Situation · Vincennes test (test-1) · live at 09:00");
    expect(said).toContain("Units (0)");
    expect(said).toContain("Tracks (0)");
    expect(said).toContain("Waiting (0)");
    expect(said).toContain("Recent (newest first)");
    expect(said).toContain("- Nothing heard yet.");
  });

  it("names a unit, a track and the latest report", () => {
    const said = handover(view({ units: [unit()], tracks: [track()], feed: [feed()] }), {
      session: "test-1",
      now: 1000,
      mode: "live",
      format: fmt,
    });
    expect(said).toContain("- ALPHA 1: on the net, last heard 09:00, Mairie de Vincennes · ±50 m");
    expect(said).toContain("- T1: unknown vehicle, Mairie de Vincennes · ±50 m, seen by ALPHA 1 at 09:00");
    expect(said).toContain("- 09:00 ALPHA 1: at the town hall");
  });

  it("marks a unit that has gone silent and keeps its question", () => {
    const said = handover(
      view({
        units: [
          unit({
            lastHeard: 1000,
            pending: { reportId: "r1", ts: 1000, question: "Where are you?", candidates: [] },
          }),
        ],
      }),
      { session: "test-1", now: 20 * 60_000, mode: "replay", format: fmt },
    );
    expect(said).toContain("· replay at 09:00");
    expect(said).toContain("silent");
    expect(said).toContain("question: Where are you?");
  });
});
