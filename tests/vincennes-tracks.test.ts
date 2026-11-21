import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { distanceM } from "../lib/geo/geo";
import { resolveReport } from "../lib/geo/tracks";
import type { Affiliation, Intent, Resolution, TrackKind } from "../lib/geo/types";
import { foldLog, type SessionState } from "../lib/reports/fold";
import { createMission, recordAnswer, reportContext, saveReport } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";

// The Vincennes script with tracks (scenarios/vincennes-tracks.json), played through the same
// steps as POST /api/report with no model: the intents are the ones hosted Mistral returned for
// the script's sentences on 21 November. Every sighting in it is made up.
interface Step {
  id: string;
  t: number;
  callsign: string;
  lang: Intent["language"];
  text: string;
  expect: { status: Resolution["status"]; feature_id?: string; track?: { n?: number; affiliation?: Affiliation | null; kind?: TrackKind } };
  choose?: string;
}

const INTENTS: Record<string, Partial<Intent>> = {
  t1: { "kind": "position", "landmark_text": "Bérault metro", "landmark_name": "Bérault", "landmark_name_lemma": "Bérault", "landmark_category": "metro_station", "relation": "at", "language": "en", "subject": "self" },
  t2: { "kind": "position", "landmark_text": "mairie de Vincennes", "landmark_name": "mairie de Vincennes", "landmark_name_lemma": "mairie de Vincennes", "landmark_category": "town_hall", "relation": "at", "language": "fr", "subject": "self" },
  t3: { "kind": "position", "landmark_text": "Avenue de Paris", "landmark_name": "Avenue de Paris", "landmark_name_lemma": "Avenue de Paris", "landmark_category": "street", "relation": "at", "language": "en", "subject": "track", "track_kind": "vehicle", "track_count": 2, "track_text": "two enemy vehicles", "track_heading": "east" },
  t4: { "kind": "position", "distance_m": 300, "direction": "north", "language": "en", "subject": "track", "track_kind": "drone", "track_text": "a drone" },
  t5: { "kind": "position", "landmark_text": "the church", "landmark_category": "church", "relation": "near", "language": "en", "subject": "track", "track_kind": "vehicle", "track_text": "suspicious vehicle" },
  t6: { "kind": "position", "landmark_text": "the cemetery", "landmark_category": "cemetery", "relation": "near", "language": "en", "subject": "track", "track_kind": "people", "track_text": "Enemy patrol" },
  t7: { "kind": "position", "landmark_text": "Avenue de Nogent", "landmark_name": "Avenue de Nogent", "landmark_name_lemma": "Avenue de Nogent", "landmark_category": "street", "relation": "at", "language": "en", "subject": "track", "track_ref": 1, "track_kind": "other" },
  t8: { "kind": "other", "language": "en", "subject": "track", "track_ref": 2, "track_kind": "other", "track_text": "hostile" },
  t9: { "kind": "position", "landmark_text": "la mairie", "landmark_category": "town_hall", "relation": "in_front_of", "language": "fr", "subject": "track", "track_kind": "vehicle", "track_text": "Voiture civile" },
  t10: { "kind": "position", "landmark_text": "Vincennes station", "landmark_name": "Vincennes", "landmark_name_lemma": "Vincennes", "landmark_category": "metro_station", "relation": "at", "language": "en", "subject": "track", "track_kind": "drone_team", "track_text": "Friendly drone team" },
  t11: { "kind": "position", "direction": "east", "language": "en", "subject": "track", "track_kind": "vehicle", "track_text": "enemy vehicle" },
};

const gaz = loadGazetteer("vincennes");
const byId = (id: string) => gaz.find((f) => f.id === id)!;
const T0 = Date.UTC(2026, 10, 21, 10, 0, 0);

describe("the Vincennes script with tracks", () => {
  let dir: string;
  let session = "";
  let steps: Step[] = [];
  const replies = new Map<string, Resolution>();
  let state: SessionState;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vincennes-tracks-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    const scenario = JSON.parse(await readFile(path.join(__dirname, "../scenarios/vincennes-tracks.json"), "utf8")) as { area: "vincennes"; steps: Step[] };
    steps = scenario.steps;
    // A new mission with no start point: track numbers count from 1, and both units check in first.
    const m = await createMission({ area: "vincennes", name: "Tracks", start: null }, T0);
    if (!m.ok) throw new Error("no mission");
    session = m.mission.code;
    for (const step of steps) {
      const now = T0 + step.t * 1000;
      const ctx = await reportContext(session, step.callsign, { area: "vincennes", lastPosition: null }, now);
      if (!ctx.ok) throw new Error(ctx.error);
      const intent: Intent = { kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: null, confidence: 0.9, language: step.lang, ...INTENTS[step.id] };
      const resolution = resolveReport({ intent, transcript: step.text, lastPosition: ctx.lastPosition, now, gazetteer: gaz, tracks: ctx.tracks, observer: step.callsign });
      const saved = await saveReport({ session, callsign: step.callsign, seq: null, clientTs: null, area: "vincennes", transcript: step.text, language: step.lang, intent, resolution, lastPosition: ctx.lastPosition, timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 } }, now);
      if (!saved) throw new Error("not saved");
      replies.set(step.id, saved.resolution);
      if (saved.resolution.status === "ambiguous" && step.choose) await recordAnswer(session, saved.id, step.choose, now + 3000);
    }
    state = foldLog((await getStore().list(session)).entries);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("has a model reading for every step, and names places the gazetteer has", () => {
    expect(steps.map((s) => s.id)).toEqual(Object.keys(INTENTS));
    for (const s of steps) {
      if (s.expect.feature_id) expect(byId(s.expect.feature_id), `${s.id}: ${s.expect.feature_id}`).toBeDefined();
      if (s.choose) expect(byId(s.choose), `${s.id}: ${s.choose}`).toBeDefined();
    }
  });

  it("every step gives the answer the script expects", () => {
    for (const s of steps) {
      const r = replies.get(s.id)!;
      expect(r.status, s.id).toBe(s.expect.status);
      if (s.expect.feature_id) expect(r.evidence.feature_id, s.id).toBe(s.expect.feature_id);
      if (s.expect.track) expect(r.track, s.id).toMatchObject(s.expect.track);
      // A step that expects no track and places something is about the speaker.
      else if (r.status !== "unresolved") expect(r.track, s.id).toBeUndefined();
      // A report about a track never carries a pin for the speaker.
      if (r.track) expect(r.pin, s.id).toBeUndefined();
    }
  });

  it("says each number back, in the speaker's language, and asks instead of guessing", () => {
    expect(replies.get("t3")?.track?.say).toBe("Track 1, hostile vehicle, count 2, Avenue de Paris.");
    expect(replies.get("t4")?.track?.say).toBe("Track 2, unknown drone, 300 metres north of you.");
    expect(replies.get("t5")?.track?.say).toBe("Track 3, suspect vehicle, Église Notre-Dame.");
    expect(replies.get("t6")?.question).toBe("Track 4. Which cemetery: Cimetière Nord de Saint-Mandé, or Cimetière ancien?");
    expect(replies.get("t7")?.track?.say).toBe("Track 1, now Avenue de Nogent.");
    expect(replies.get("t8")?.track?.say).toBe("Track 2, hostile.");
    expect(replies.get("t9")?.track?.say).toBe("Piste 5, véhicule civil, Mairie de Vincennes.");
    expect(replies.get("t10")?.track?.say).toBe("Track 6, friendly drone team, Vincennes.");
    // A direction with no distance gives no point: no track is opened, and the app asks.
    expect(replies.get("t11")).toMatchObject({ status: "unresolved", question: "How far is it, and which way? Or name a place near it." });
  });

  it("leaves six tracks on the map, each as its reports left it", () => {
    expect(state.tracks.map((t) => [t.n, t.affiliation, t.kind, t.position?.label])).toEqual([
      [1, "hostile", "vehicle", "Avenue de Nogent"],
      [2, "hostile", "drone", "300 m north of BRAVO 2"],
      [3, "suspect", "vehicle", "Église Notre-Dame"],
      [4, "hostile", "people", "Cimetière Nord de Saint-Mandé"],
      [5, "neutral", "vehicle", "Mairie de Vincennes"],
      [6, "friendly", "drone_team", "Vincennes"],
    ]);
    const [one, two, , four] = state.tracks;
    // Track 1 moved: one earlier sighting on Avenue de Paris, and "moving east" belonged to that one.
    expect(one).toMatchObject({ count: 2, heading: null, openedBy: "ALPHA 1", seenBy: "ALPHA 1" });
    expect(one.trail).toHaveLength(1);
    expect(distanceM(one.trail[0], one.position!)).toBeGreaterThan(300);
    // Track 2 was placed from the observer, as an estimate, and turned hostile without moving.
    expect(two.position).toMatchObject({ estimated: true });
    expect(two.trail).toHaveLength(0);
    // Track 4 was placed by the answer to its question.
    expect(four.pendingReport).toBeNull();
    expect(state.tracks.every((t) => t.position && !t.pendingReport)).toBe(true);
  });

  it("moves neither unit: both are still where they checked in", () => {
    const at = (callsign: string) => state.units.find((u) => u.callsign === callsign)!;
    expect(at("ALPHA 1").position).toMatchObject({ label: "Bérault" });
    expect(at("BRAVO 2").position).toMatchObject({ label: "Mairie de Vincennes" });
    expect(at("ALPHA 1").trail).toHaveLength(0);
    expect(at("BRAVO 2").trail).toHaveLength(0);
    expect(state.units.every((u) => !u.pending)).toBe(true);
  });
});
