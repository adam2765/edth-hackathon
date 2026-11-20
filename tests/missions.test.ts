import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Candidate, Resolution } from "../lib/geo/types";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { FADE_AFTER_MS, foldLog } from "../lib/reports/fold";
import { START_RADIUS_M, startPointFrom, startPosition, summarizeMission } from "../lib/reports/mission";
import {
  createMission,
  deleteMission,
  endMission,
  joinMission,
  listMissions,
  recordAnswer,
  recordReport,
  reportContext,
  type ReportInput,
} from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import type { LogEntry, StartPoint } from "../lib/reports/types";

const T0 = Date.UTC(2026, 10, 20, 18, 0, 0);
const at = (s: number) => T0 + s * 1000;

const START: StartPoint = { id: "castle/chateau", name: "Château de Vincennes", category: "castle", lat: 48.8427, lon: 2.4358, radius_m: 300 };

function cand(id: string, name: string, lat: number, lon: number): Candidate {
  return { id, name, category: "metro_station", lat, lon, distance_m: 100, placement: { pin: { lat, lon }, radius_m: 30 } };
}
const BERAULT = cand("station/berault", "Bérault", 48.8456, 2.4285);
const MAIRIE = cand("town_hall/vincennes", "Mairie de Vincennes", 48.8476, 2.4392);
const RESOLVED: Resolution = { status: "resolved", pin: BERAULT.placement.pin, radius_m: 30, candidates: [BERAULT], evidence: { rule: "exact", feature_id: BERAULT.id, detail: "" } };
const ASK: Resolution = { status: "ambiguous", candidates: [BERAULT, MAIRIE], question: "Which one?", evidence: { rule: "ask", detail: "" } };

function input(session: string, callsign: string, resolution: Resolution, extra: Partial<ReportInput> = {}): ReportInput {
  return {
    session,
    callsign,
    seq: null,
    clientTs: null,
    area: "vincennes",
    transcript: "I'm at Bérault",
    language: "en",
    intent: null,
    resolution,
    lastPosition: null,
    timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 },
    ...extra,
  };
}

describe("a mission in the log", () => {
  const log: LogEntry[] = [
    { kind: "mission", id: "m", session: "vincennes-1", ts: at(0), area: "vincennes", name: "Walk", start: START },
    { kind: "join", id: "j1", session: "vincennes-1", callsign: "ALPHA 1", ts: at(10), device: "phone-aaaa", position: startPosition(START) },
    { kind: "join", id: "j2", session: "vincennes-1", callsign: "BRAVO 1", ts: at(20), device: "phone-bbbb", position: null },
  ];

  it("a unit that joins starts around the start point, as an estimate", () => {
    const s = foldLog(log);
    expect(s.mission).toMatchObject({ name: "Walk", area: "vincennes", ended: null });
    const alpha = s.units.find((u) => u.callsign === "ALPHA 1")!;
    expect(alpha.position).toMatchObject({ lat: START.lat, lon: START.lon, radius_m: 300, estimated: true });
    expect(alpha.joined).toBe(at(10));
    expect(alpha.device).toBe("phone-aaaa");
    expect(s.units.find((u) => u.callsign === "BRAVO 1")!.position).toBeNull();
    expect(s.feed.map((f) => [f.kind, f.callsign])).toEqual([["join", "BRAVO 1"], ["join", "ALPHA 1"]]);
    expect(s.feed[0].outcome).toMatch(/Not placed yet/);
  });

  it("a join never moves a unit that is already placed", () => {
    const placed: LogEntry[] = [
      ...log,
      { kind: "report", id: "r1", session: "vincennes-1", callsign: "ALPHA 1", seq: null, ts: at(30), clientTs: null, area: "vincennes", transcript: "", language: null, intent: null, resolution: RESOLVED, lastPosition: null, position: { lat: BERAULT.lat, lon: BERAULT.lon, radius_m: 30, label: "Bérault" }, timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 } },
      { kind: "join", id: "j3", session: "vincennes-1", callsign: "ALPHA 1", ts: at(40), device: "phone-cccc", position: startPosition(START) },
    ];
    const alpha = foldLog(placed).units.find((u) => u.callsign === "ALPHA 1")!;
    expect(alpha.position?.label).toBe("Bérault");
    // The start point was only assumed, so it is not part of the trail.
    expect(alpha.trail).toEqual([]);
    expect(alpha.device).toBe("phone-cccc");
    expect(foldLog(placed).feed[0].outcome).toBe("Joined again from another phone.");
  });

  it("a question still open when the mission ends is closed, unanswered", () => {
    const asked: LogEntry[] = [
      ...log,
      { kind: "report", id: "r2", session: "vincennes-1", callsign: "BRAVO 1", seq: null, ts: at(30), clientTs: null, area: "vincennes", transcript: "", language: null, intent: null, resolution: ASK, lastPosition: null, position: null, timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 } },
      { kind: "end", id: "e", session: "vincennes-1", ts: at(60) },
    ];
    expect(foldLog(asked, at(59)).units.find((u) => u.callsign === "BRAVO 1")!.pending).not.toBeNull();
    const s = foldLog(asked);
    expect(s.units.find((u) => u.callsign === "BRAVO 1")!.pending).toBeNull();
    expect(s.feed.find((f) => f.id === "r2")).toMatchObject({ expired: true, answer: null });
  });

  it("the end is in the replay at its time, and summarised", () => {
    const ended: LogEntry[] = [...log, { kind: "end", id: "e", session: "vincennes-1", ts: at(60) }];
    expect(foldLog(ended, at(59)).mission?.ended).toBeNull();
    expect(foldLog(ended).mission?.ended).toBe(at(60));
    expect(summarizeMission("vincennes-1", ended)).toMatchObject({ code: "vincennes-1", units: 2, reports: 0, opened: at(0), ended: at(60), last: at(60) });
    expect(summarizeMission("old", [])).toBeNull();
  });

  it("a start point is the place with a circle of 300 m, or the place's size if larger", () => {
    const g = loadGazetteer("vincennes");
    const small = g.find((f) => f.category === "metro_station")!;
    expect(startPointFrom(small)).toMatchObject({ id: small.id, radius_m: START_RADIUS_M });
    const big = g.find((f) => f.bbox && f.category === "park" && startPointFrom(f).radius_m > START_RADIUS_M);
    if (big) expect(startPointFrom(big).radius_m).toBeGreaterThan(START_RADIUS_M);
  });
});

describe("missions on the coordinator", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "missions-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("opens missions with a code per area, never reused", async () => {
    const a = await createMission({ area: "vincennes", name: "One", start: START }, at(0));
    const b = await createMission({ area: "vincennes", name: "Two", start: null }, at(1));
    const k = await createMission({ area: "kyiv", name: "Kyiv", start: null }, at(2));
    expect([a, b, k].map((r) => r.ok && r.mission.code)).toEqual(["vincennes-1", "vincennes-2", "kyiv-1"]);
    await endMission("vincennes-2", at(3));
    expect(await deleteMission("vincennes-2")).toEqual({ ok: true });
    const c = await createMission({ area: "vincennes", name: "Three", start: null }, at(4));
    expect(c.ok && c.mission.code).toBe("vincennes-3");
    expect(await readdir(path.join(dir, "deleted"))).toHaveLength(1);
  });

  it("lists open missions first, newest first", async () => {
    await endMission("kyiv-1", at(5));
    const { stored, missions } = await listMissions();
    expect(stored).toBe(true);
    expect(missions.map((m) => [m.code, m.ended != null])).toEqual([["vincennes-3", false], ["vincennes-1", false], ["kyiv-1", true]]);
  });

  it("joins: the start point on a first join, the same unit back on a rejoin, one phone per call sign", async () => {
    const first = await joinMission("vincennes-1", "ALPHA 1", "phone-aaaa", at(10));
    expect(first).toMatchObject({ ok: true, reply: { callsign: "ALPHA 1", rejoined: false, positionTs: at(10), position: { estimated: true, radius_m: 300 } } });
    const again = await joinMission("vincennes-1", "ALPHA 1", "phone-aaaa", at(20));
    expect(again).toMatchObject({ ok: true, reply: { rejoined: true, positionTs: at(10) } });
    expect((await getStore().list("vincennes-1")).total).toBe(2); // mission line and one join

    const other = await joinMission("vincennes-1", "ALPHA 1", "phone-bbbb", at(30));
    expect(other).toMatchObject({ ok: false, status: 409, taken: true });
    // Silent for 3 minutes: another phone may take the call sign over.
    const takeover = await joinMission("vincennes-1", "ALPHA 1", "phone-bbbb", at(10) + FADE_AFTER_MS + 1);
    expect(takeover).toMatchObject({ ok: true, reply: { rejoined: false } });

    expect(await joinMission("nope-1", "ALPHA 1", "phone-aaaa", at(40))).toMatchObject({ ok: false, status: 404 });
    expect(await joinMission("kyiv-1", "ALPHA 1", "phone-aaaa", at(40))).toMatchObject({ ok: false, status: 409, ended: true });
  });

  it("a report in a mission takes the area and the last position from the log", async () => {
    // The phone says Kyiv and sends a position; the mission says Vincennes, and ALPHA 1 is at the start point.
    const fromPhone = { area: "kyiv" as const, lastPosition: { lat: 50.45, lon: 30.52, ts: at(50) } };
    const c1 = await reportContext("vincennes-1", "ALPHA 1", fromPhone, at(60));
    expect(c1).toMatchObject({ ok: true, inMission: true, area: "vincennes", lastPosition: { lat: START.lat, lon: START.lon, ts: at(10), uncertainty_m: 300, radius_m: 300 } });
    // A call sign that never joined starts from the start point too.
    const c2 = await reportContext("vincennes-1", "CHARLIE 1", fromPhone, at(60));
    expect(c2).toMatchObject({ ok: true, lastPosition: { lat: START.lat, ts: at(60), uncertainty_m: 300 } });

    await recordReport(input("vincennes-1", "ALPHA 1", RESOLVED), at(70));
    const c3 = await reportContext("vincennes-1", "ALPHA 1", fromPhone, at(80));
    expect(c3).toMatchObject({ ok: true, lastPosition: { lat: BERAULT.lat, lon: BERAULT.lon, ts: at(70), radius_m: 30 } });
    expect(c3.ok && c3.lastPosition?.uncertainty_m).toBeUndefined();

    expect(await reportContext("nope-1", "ALPHA 1", fromPhone, at(80))).toMatchObject({ ok: false, status: 404 });
    expect(await reportContext("kyiv-1", "ALPHA 1", fromPhone, at(80))).toMatchObject({ ok: false, status: 409, ended: true });
  });

  it("a call sign that reports without joining joins with that report, once", async () => {
    await recordReport(input("vincennes-1", "CHARLIE 1", ASK, { seq: 1, clientTs: at(89) }), at(90));
    await recordReport(input("vincennes-1", "CHARLIE 1", ASK, { seq: 2, clientTs: at(94) }), at(95));
    const { entries } = await getStore().list("vincennes-1");
    const joins = entries.filter((e) => e.kind === "join" && e.callsign === "CHARLIE 1");
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ device: null, position: { estimated: true } });
    // Sent twice: saved once.
    const again = await recordReport(input("vincennes-1", "CHARLIE 1", ASK, { seq: 2, clientTs: at(94) }), at(96));
    expect(entries.filter((e) => e.kind === "report" && e.callsign === "CHARLIE 1").map((e) => e.id)).toContain(again);
  });

  it("an ended mission takes no more reports or answers, and can then be deleted", async () => {
    const { entries } = await getStore().list("vincennes-1");
    const asked = entries.filter((e) => e.kind === "report" && e.callsign === "CHARLIE 1").at(-1)!;
    expect(await deleteMission("vincennes-1")).toMatchObject({ ok: false, status: 409 });

    const ended = await endMission("vincennes-1", at(100));
    expect(ended).toMatchObject({ ok: true, mission: { ended: at(100) } });
    expect(await endMission("vincennes-1", at(110))).toMatchObject({ ok: true, mission: { ended: at(100) } });

    expect(await recordAnswer("vincennes-1", asked.id, BERAULT.id, at(120))).toMatchObject({ ok: false, status: 409, ended: true });
    expect(await recordReport(input("vincennes-1", "ALPHA 1", RESOLVED), at(130))).toBeNull();

    expect(await deleteMission("vincennes-1")).toEqual({ ok: true });
    expect((await listMissions()).missions.map((m) => m.code)).not.toContain("vincennes-1");
  });
});
