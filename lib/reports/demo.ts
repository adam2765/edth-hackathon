/**
 * A recorded mission for the public command post. The site keeps no logs, so `/cp?demo=1` (and
 * `?session=demo`) serves this one instead: four units, three tracks, a question asked back and
 * answered, a spoken reply, a request for recon and the drone sent to look. Every entry is a real
 * log line, folded by the same `foldLog` as a live mission; the times are shifted to the moment of
 * the request, so the picture is fresh and the replay bar has a morning to scrub. Read only.
 *
 * Nothing here comes from a model at request time: the intents and resolutions are the recorded
 * output of the pipeline. No audio is kept.
 */
import type { AreaId } from "@/lib/geo/areas";
import type { Affiliation, Candidate, Direction, Intent, Resolution, TrackKind } from "@/lib/geo/types";
import { DEMO_SESSION, type JoinEntry, type LogEntry, type MissionEntry, type ReportEntry, type UnitPosition } from "./types";

const AREA: AreaId = "vincennes";
const T = (seconds: number) => -seconds * 1000;

const MAIRIE = { lat: 48.84765, lon: 2.43977 };
const BERAULT = { lat: 48.84543, lon: 2.4293 };
const CHATEAU = { lat: 48.84276, lon: 2.43589 };
const AVENUE = { lat: 48.8455, lon: 2.42848 };
const NOTRE_DAME = { lat: 48.84747, lon: 2.43878 };
const SAINT_LOUIS = { lat: 48.84803, lon: 2.41916 };
const CIMETIERE = { lat: 48.84739, lon: 2.44485 };
const FORT_NEUF = { lat: 48.84234, lon: 2.43911 };

function pos(label: string, p: { lat: number; lon: number }, radius_m = 30): UnitPosition {
  return { label, lat: p.lat, lon: p.lon, radius_m };
}

function intent(language: Intent["language"], more: Partial<Intent> = {}): Intent {
  return {
    kind: "position",
    landmark_text: null,
    landmark_name: null,
    landmark_category: null,
    relation: null,
    language,
    confidence: 0.9,
    ...more,
  };
}

function resolved(p: { lat: number; lon: number }, radius_m: number, rule: string, detail: string): Resolution {
  return { status: "resolved", pin: p, radius_m, candidates: [], evidence: { rule, detail } };
}

function sighting(
  n: number,
  affiliation: Affiliation,
  kind: TrackKind,
  count: number | null,
  text: string,
  heading: Direction | null,
  where: { label: string; p: { lat: number; lon: number }; radius_m: number },
  from: { lat: number; lon: number },
  opened: boolean,
): { track: NonNullable<ReportEntry["track"]>; resolution: Resolution } {
  const placement = pos(where.label, where.p, where.radius_m);
  return {
    track: { n, affiliation, kind, count, text, heading, position: placement, from },
    resolution: {
      status: "resolved",
      candidates: [],
      track: { n, opened, affiliation, kind, count, text, heading, placement: { pin: where.p, radius_m: where.radius_m }, label: where.label, say: `Track ${n}, ${text}.` },
      evidence: { rule: "track_sighting", detail: `the words named a ${kind}; the place is the landmark said` },
    },
  };
}

function report(
  id: string,
  seconds: number,
  callsign: string,
  transcript: string,
  language: string | null,
  read: Intent | null,
  resolution: Resolution,
  position: UnitPosition | null,
  extra: Pick<Partial<ReportEntry>, "track"> = {},
): ReportEntry {
  return {
    kind: "report",
    id,
    session: DEMO_SESSION,
    callsign,
    seq: null,
    ts: T(seconds),
    clientTs: null,
    area: AREA,
    transcript,
    language,
    intent: read,
    resolution,
    lastPosition: null,
    position,
    ...extra,
    timings_ms: { stt: 720 + (seconds % 5) * 40, extract: 310 + (seconds % 7) * 11, resolve: 3, total: 1050 + (seconds % 7) * 11 },
  };
}

const NOTRE_DAME_CANDIDATE: Candidate = {
  id: "way/83814063",
  name: "Église Notre-Dame",
  category: "church",
  lat: NOTRE_DAME.lat,
  lon: NOTRE_DAME.lon,
  distance_m: 430,
  placement: { pin: NOTRE_DAME, radius_m: 30 },
};

const SAINT_LOUIS_CANDIDATE: Candidate = {
  id: "way/83818861",
  name: "Église Saint-Louis",
  category: "church",
  lat: SAINT_LOUIS.lat,
  lon: SAINT_LOUIS.lon,
  distance_m: 1460,
  placement: { pin: SAINT_LOUIS, radius_m: 30 },
};

const track1 = sighting(1, "suspect", "vehicle", 2, "two suspicious vehicles", "east", { label: "Avenue de Paris", p: AVENUE, radius_m: 80 }, MAIRIE, true);
const track2 = sighting(2, "unknown", "drone", null, "an unknown drone", null, { label: "Église Notre-Dame", p: NOTRE_DAME, radius_m: 80 }, BERAULT, true);
const track3 = sighting(3, "suspect", "vehicle", 1, "a suspicious vehicle", null, { label: "Cimetière ancien", p: CIMETIERE, radius_m: 60 }, CHATEAU, true);
const track1Again = sighting(1, "suspect", "vehicle", 2, "the vehicles", "east", { label: "Avenue de Paris", p: AVENUE, radius_m: 80 }, CHATEAU, false);
const track2Again = sighting(2, "unknown", "drone", null, "the drone", null, { label: "Église Notre-Dame", p: NOTRE_DAME, radius_m: 80 }, BERAULT, false);
const track3Again = sighting(3, "suspect", "vehicle", 1, "the vehicle", null, { label: "Cimetière ancien", p: CIMETIERE, radius_m: 60 }, NOTRE_DAME, false);

const entries: LogEntry[] = [
  {
    kind: "mission",
    id: "demo-01",
    session: DEMO_SESSION,
    ts: T(720),
    area: AREA,
    name: "Vincennes · demo",
    start: null,
    roster: ["ALPHA 1", "BRAVO 2", "CHARLIE 3", "DRONE 1"],
  } satisfies MissionEntry,
  { kind: "join", id: "demo-02", session: DEMO_SESSION, callsign: "ALPHA 1", ts: T(690), device: null, position: null } satisfies JoinEntry,
  { kind: "join", id: "demo-03", session: DEMO_SESSION, callsign: "BRAVO 2", ts: T(680), device: null, position: null } satisfies JoinEntry,
  { kind: "join", id: "demo-04", session: DEMO_SESSION, callsign: "CHARLIE 3", ts: T(670), device: null, position: null } satisfies JoinEntry,
  { kind: "join", id: "demo-05", session: DEMO_SESSION, callsign: "DRONE 1", ts: T(650), device: null, position: null } satisfies JoinEntry,

  report("demo-06", 630, "ALPHA 1", "Je suis à la mairie de Vincennes.", "fr",
    intent("fr", { landmark_text: "la mairie de Vincennes", landmark_name: "Mairie de Vincennes", landmark_category: "town_hall", relation: "at", confidence: 0.95 }),
    resolved(MAIRIE, 30, "landmark_name", "one place named Mairie de Vincennes"), pos("Mairie de Vincennes", MAIRIE)),
  report("demo-07", 590, "BRAVO 2", "I am at the Bérault metro station.", "en",
    intent("en", { landmark_text: "the Bérault metro station", landmark_name: "Bérault", landmark_category: "metro_station", relation: "at", confidence: 0.93 }),
    resolved(BERAULT, 30, "landmark_name", "one metro station named Bérault"), pos("Bérault", BERAULT)),
  report("demo-08", 550, "CHARLIE 3", "Au château de Vincennes.", "fr",
    intent("fr", { landmark_text: "le château de Vincennes", landmark_name: "Château de Vincennes", landmark_category: "castle", relation: "at", confidence: 0.94 }),
    resolved(CHATEAU, 40, "landmark_name", "one castle named Château de Vincennes"), pos("Château de Vincennes", CHATEAU, 40)),

  { kind: "fix", id: "demo-09", session: DEMO_SESSION, ts: T(520), by: "CP", callsign: "DRONE 1", position: pos("Fort Neuf de Vincennes", FORT_NEUF, 50), note: "set at the base before the mission" },
  { kind: "unit", id: "demo-10", session: DEMO_SESSION, ts: T(510), by: "CP", callsign: "DRONE 1", unit_kind: "drone" },

  report("demo-11", 460, "ALPHA 1", "Two suspicious vehicles on Avenue de Paris, moving east.", "en",
    intent("en", { subject: "track", landmark_text: "Avenue de Paris", landmark_name: "Avenue de Paris", landmark_category: "street", relation: "at", track_kind: "vehicle", track_count: 2, track_text: "two suspicious vehicles", track_heading: "east", confidence: 0.88 }),
    track1.resolution, null, { track: track1.track }),
  report("demo-12", 380, "BRAVO 2", "I see an unknown drone over the church.", "en",
    intent("en", { subject: "track", landmark_text: "the church", landmark_name: "Église Notre-Dame", landmark_category: "church", relation: "near", track_kind: "drone", track_text: "an unknown drone", confidence: 0.84 }),
    track2.resolution, null, { track: track2.track }),
  report("demo-13", 340, "CHARLIE 3", "A suspicious vehicle at the cemetery.", "en",
    intent("en", { subject: "track", landmark_text: "the cemetery", landmark_name: "Cimetière ancien", landmark_category: "cemetery", relation: "at", track_kind: "vehicle", track_count: 1, track_text: "a suspicious vehicle", confidence: 0.86 }),
    track3.resolution, null, { track: track3.track }),

  report("demo-14", 280, "CHARLIE 3", "I am near the church.", "en",
    intent("en", { landmark_text: "the church", landmark_category: "church", relation: "near", confidence: 0.61 }),
    {
      status: "ambiguous",
      candidates: [NOTRE_DAME_CANDIDATE, SAINT_LOUIS_CANDIDATE],
      question: "Which church: Notre-Dame or Saint-Louis?",
      evidence: { rule: "two_churches", detail: "two churches are within reach of the last position" },
    }, null),
  {
    kind: "reply",
    id: "demo-15",
    session: DEMO_SESSION,
    callsign: "CHARLIE 3",
    ts: T(260),
    clientTs: null,
    report_id: "demo-14",
    transcript: "The one by the town hall.",
    language: "en",
    choice: NOTRE_DAME_CANDIDATE.id,
    how: "name",
  },
  {
    kind: "answer",
    id: "demo-16",
    session: DEMO_SESSION,
    callsign: "CHARLIE 3",
    ts: T(240),
    report_id: "demo-14",
    choice: NOTRE_DAME_CANDIDATE.id,
    position: pos("Église Notre-Dame", NOTRE_DAME),
    by: "CP",
  },

  { kind: "request", id: "demo-17", session: DEMO_SESSION, ts: T(210), callsign: "ALPHA 1", n: 1, words: "Send the drone to look at the vehicles.", report_id: null },
  { kind: "task", id: "demo-18", session: DEMO_SESSION, ts: T(190), by: "CP", action: "send", unit: "DRONE 1", n: 1, request: "demo-17" },

  report("demo-19", 150, "BRAVO 2", "The drone is still over the church.", "en",
    intent("en", { subject: "track", track_ref: 2, landmark_text: "the church", landmark_name: "Église Notre-Dame", landmark_category: "church", relation: "near", track_kind: "drone", track_text: "the drone", confidence: 0.8 }),
    track2Again.resolution, null, { track: track2Again.track }),
  report("demo-20", 120, "CHARLIE 3", "The vehicle is still at the cemetery.", "en",
    intent("en", { subject: "track", track_ref: 3, landmark_text: "the cemetery", landmark_name: "Cimetière ancien", landmark_category: "cemetery", relation: "at", track_kind: "vehicle", track_text: "the vehicle", confidence: 0.82 }),
    track3Again.resolution, null, { track: track3Again.track }),

  report("demo-21", 70, "ALPHA 1", "Still at the château.", "en",
    intent("en", { landmark_text: "the château", landmark_name: "Château de Vincennes", landmark_category: "castle", relation: "at", confidence: 0.9 }),
    resolved(CHATEAU, 40, "landmark_name", "one castle named Château de Vincennes"), pos("Château de Vincennes", CHATEAU, 40)),
  report("demo-22", 60, "CHARLIE 3", "Still near Notre-Dame.", "en",
    intent("en", { landmark_text: "Notre-Dame", landmark_name: "Église Notre-Dame", landmark_category: "church", relation: "near", confidence: 0.9 }),
    resolved(NOTRE_DAME, 30, "landmark_name", "one church named Église Notre-Dame"), pos("Église Notre-Dame", NOTRE_DAME)),
  report("demo-23", 55, "DRONE 1", "Holding over Fort Neuf.", "en",
    intent("en", { landmark_text: "Fort Neuf", landmark_name: "Fort Neuf de Vincennes", landmark_category: "stop", relation: "near", confidence: 0.85 }),
    resolved(FORT_NEUF, 50, "landmark_name", "one place named Fort Neuf de Vincennes"), pos("Fort Neuf de Vincennes", FORT_NEUF, 50)),
  report("demo-24", 30, "BRAVO 2", "Holding at Bérault.", "en",
    intent("en", { landmark_text: "Bérault", landmark_name: "Bérault", landmark_category: "metro_station", relation: "at", confidence: 0.92 }),
    resolved(BERAULT, 30, "landmark_name", "one metro station named Bérault"), pos("Bérault", BERAULT)),
  // A place set by the operator: its label says CP on the map too [243].
  { kind: "fix", id: "demo-25b", session: DEMO_SESSION, ts: T(25), by: "CP", callsign: "CHARLIE 3", position: pos("Église Notre-Dame", NOTRE_DAME), note: "the operator put it back at the church after the report" },
  report("demo-25", 20, "ALPHA 1", "The vehicles are still on Avenue de Paris.", "en",
    intent("en", { subject: "track", track_ref: 1, landmark_text: "Avenue de Paris", landmark_name: "Avenue de Paris", landmark_category: "street", relation: "at", track_kind: "vehicle", track_count: 2, track_text: "the vehicles", confidence: 0.84 }),
    track1Again.resolution, null, { track: track1Again.track }),
];

/** The demo's lines with their times moved to `now`, and the entries after the first `after`. */
export function demoLog(after = 0, now = Date.now()): { total: number; entries: LogEntry[] } {
  const shifted = entries.map((e) => ({ ...e, ts: e.ts + now }));
  return { total: shifted.length, entries: shifted.slice(Math.max(0, after)) };
}

/** The demo's lines at their recorded offsets from now: for tests. */
export function demoEntries(): LogEntry[] {
  return entries;
}
