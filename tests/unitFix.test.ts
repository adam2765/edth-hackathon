import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Candidate, Resolution } from "../lib/geo/types";
import { decisionsOf } from "../lib/reports/decisions";
import { foldLog, knownAt } from "../lib/reports/fold";
import { parseFix } from "../lib/reports/plot";
import { createMission, endMission, recordAnswer, recordFix, reportContext, saveReport } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import type { FixEntry, LogEntry, ReportEntry, StartPoint, TrackSighting, UnitPosition } from "../lib/reports/types";

// A unit placed by hand at the command post [243]: the app did not place it, or placed it wrongly.

const T0 = Date.UTC(2026, 10, 22, 11, 0, 0);
const at = (s: number) => T0 + s * 1000;
const S = "vincennes-1";
const CHATEAU = { lat: 48.84276, lon: 2.43589 };
const MAIRIE = { lat: 48.84765, lon: 2.43977 };
const NO_TIME = { stt: 0, extract: 0, resolve: 0, total: 0 };

const castle: Candidate = { id: "castle/a", name: "Château de Vincennes", category: "castle", lat: CHATEAU.lat, lon: CHATEAU.lon, distance_m: 10, placement: { pin: CHATEAU, radius_m: 30 } };
const mairie: Candidate = { id: "town_hall/b", name: "Mairie de Vincennes", category: "town_hall", lat: MAIRIE.lat, lon: MAIRIE.lon, distance_m: 10, placement: { pin: MAIRIE, radius_m: 30 } };
const ASK: Resolution = { status: "ambiguous", candidates: [castle, mairie], question: "Which one: Château de Vincennes, or Mairie de Vincennes?", evidence: { rule: "ask", detail: "" } };
const HOW_FAR: Resolution = { status: "unresolved", candidates: [], question: "How far east is it? Or name a place near it.", evidence: { rule: "no_distance", detail: "" } };
const PLACED: Resolution = { status: "resolved", candidates: [], evidence: { rule: "exact", detail: "" } };
const AT_CHATEAU: UnitPosition = { lat: CHATEAU.lat, lon: CHATEAU.lon, radius_m: 30, label: "Château de Vincennes" };
const AT_MAIRIE: UnitPosition = { lat: MAIRIE.lat, lon: MAIRIE.lon, radius_m: 50, label: "Mairie de Vincennes" };

const MISSION: LogEntry = { kind: "mission", id: "m", session: S, ts: at(0), area: "vincennes", name: "By hand", start: null, roster: ["ALPHA 1", "BRAVO 2"] };

function report(id: string, s: number, callsign: string, resolution: Resolution, extra: Partial<ReportEntry> = {}): ReportEntry {
  return { kind: "report", id, session: S, callsign, seq: null, ts: at(s), clientTs: null, area: "vincennes", transcript: id, language: "en", intent: null, resolution, lastPosition: null, position: null, timings_ms: NO_TIME, ...extra };
}

function fix(id: string, s: number, callsign: string, position: UnitPosition = AT_MAIRIE, note: string | null = null): FixEntry {
  return { kind: "fix", id, session: S, ts: at(s), by: "CP", callsign, position, note };
}

const unit = (log: LogEntry[], callsign: string, upTo?: number) => foldLog(log, upTo).units.find((u) => u.callsign === callsign)!;

describe("checking what the command post sent for a unit", () => {
  it("takes a call sign and a point or a place, as for a track", () => {
    expect(parseFix({ callsign: " alpha  1 ", lat: 48.84, lon: 2.43, radius_m: 100, note: "  heard on   the net " })).toEqual({
      ok: true,
      input: { callsign: "ALPHA 1", where: { lat: 48.84, lon: 2.43 }, radius_m: 100, note: "heard on the net" },
    });
    expect(parseFix({ callsign: "ALPHA 1", place: "way/83816816" })).toMatchObject({ ok: true, input: { where: { place: "way/83816816" }, radius_m: 50, note: null } });
  });

  it("refuses one with no unit, no point, or a circle that is no circle", () => {
    expect(parseFix({ lat: 48.84, lon: 2.43 })).toMatchObject({ ok: false, error: expect.stringContaining("callsign") });
    expect(parseFix({ callsign: "ALPHA 1" })).toMatchObject({ ok: false, error: expect.stringContaining("lat") });
    expect(parseFix({ callsign: "ALPHA 1", lat: 48.84, lon: 2.43, radius_m: 1 })).toMatchObject({ ok: false });
    expect(parseFix(null)).toMatchObject({ ok: false });
  });
});

describe("a unit placed by hand, in the log", () => {
  it("moves the unit, says who placed it, and keeps where the app had it in the trail", () => {
    const log = [MISSION, report("r1", 10, "ALPHA 1", PLACED, { position: AT_CHATEAU }), fix("f1", 40, "ALPHA 1", AT_MAIRIE, "heard on the net")];
    const u = unit(log, "ALPHA 1");
    expect(u).toMatchObject({ position: AT_MAIRIE, positionTs: at(40), placedBy: "CP", atStart: false, street: null });
    expect(u.trail).toEqual([{ lat: CHATEAU.lat, lon: CHATEAU.lon, ts: at(10) }]);
    const s = foldLog(log);
    expect(s.feed[0]).toMatchObject({ kind: "note", callsign: "CP", position: AT_MAIRIE, outcome: "Moved ALPHA 1 by hand: Mairie de Vincennes (±50 m). Source: heard on the net." });
  });

  it("is not the unit being heard, but it is the command post knowing where the unit is", () => {
    const u = unit([MISSION, report("r1", 10, "ALPHA 1", PLACED, { position: AT_CHATEAU }), fix("f1", 400, "ALPHA 1")], "ALPHA 1");
    expect(u.lastHeard).toBe(at(10));
    expect(knownAt(u)).toBe(at(400));
  });

  it("places a unit on the roster that was never heard", () => {
    const log = [MISSION, fix("f1", 20, "BRAVO 2")];
    const u = unit(log, "BRAVO 2");
    expect(u).toMatchObject({ position: AT_MAIRIE, placedBy: "CP", lastHeard: 0 });
    expect(u.trail).toEqual([]);
    expect(foldLog(log).feed[0].outcome).toBe("Placed BRAVO 2 by hand: Mairie de Vincennes (±50 m).");
  });

  it("a unit still at the start point is placed, not moved, and leaves no trail from it", () => {
    const start: StartPoint = { id: "way/1", name: "Château de Vincennes", category: "castle", lat: CHATEAU.lat, lon: CHATEAU.lon, radius_m: 300 };
    const log: LogEntry[] = [
      { ...MISSION, start } as LogEntry,
      { kind: "join", id: "j", session: S, callsign: "ALPHA 1", ts: at(5), device: "d1", position: { lat: start.lat, lon: start.lon, radius_m: 300, label: "Château de Vincennes (start point)", estimated: true } },
      fix("f1", 20, "ALPHA 1"),
    ];
    const u = unit(log, "ALPHA 1");
    expect(u).toMatchObject({ position: AT_MAIRIE, atStart: false, placedBy: "CP" });
    expect(u.trail).toEqual([]);
    expect(foldLog(log).feed[0].outcome).toMatch(/^Placed ALPHA 1 by hand/);
  });

  it("the unit's next report places it again: the place is its own once more", () => {
    const log = [MISSION, fix("f1", 20, "ALPHA 1"), report("r2", 60, "ALPHA 1", PLACED, { position: AT_CHATEAU })];
    const u = unit(log, "ALPHA 1");
    expect(u).toMatchObject({ position: AT_CHATEAU, placedBy: null });
    expect(u.trail).toEqual([{ lat: MAIRIE.lat, lon: MAIRIE.lon, ts: at(20) }]);
    expect(knownAt(u)).toBe(at(60));
  });

  it("a replay before the placement shows the unit where it was", () => {
    const log = [MISSION, report("r1", 10, "ALPHA 1", PLACED, { position: AT_CHATEAU }), fix("f1", 40, "ALPHA 1")];
    expect(unit(log, "ALPHA 1", at(30))).toMatchObject({ position: AT_CHATEAU, placedBy: null });
  });

  it("a placement for a call sign the log does not have changes nothing: it never makes a unit", () => {
    const s = foldLog([MISSION, fix("f1", 20, "ZULU 9")]);
    expect(s.units.map((u) => u.callsign)).toEqual(["ALPHA 1", "BRAVO 2"]);
    expect(s.feed).toEqual([]);
  });
});

describe("a unit placed by hand while its question is open", () => {
  it("closes the unit's own question with choices: it leaves the Decisions list and says so in the feed", () => {
    const s = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK), fix("f1", 40, "BRAVO 2")]);
    expect(s.units.find((u) => u.callsign === "BRAVO 2")).toMatchObject({ pending: null, position: AT_MAIRIE });
    expect(s.feed.find((f) => f.id === "q")).toMatchObject({ overtaken: true, byHand: true, outcome: expect.stringMatching(/Closed: CP placed BRAVO 2 by hand\.$/) });
    expect(decisionsOf(s)).toEqual([]);
  });

  it("closes a question with no choices too", () => {
    const s = foldLog([MISSION, report("q", 10, "BRAVO 2", HOW_FAR), fix("f1", 40, "BRAVO 2")]);
    expect(s.units.find((u) => u.callsign === "BRAVO 2")?.prompt).toBeNull();
    expect(s.feed.find((f) => f.id === "q")).toMatchObject({ overtaken: true, byHand: true });
    expect(decisionsOf(s)).toEqual([]);
  });

  it("leaves a question about a track open: where the unit is says nothing about the track", () => {
    const sighting: TrackSighting = { n: 1, affiliation: "hostile", kind: "vehicle", count: null, text: "enemy vehicle", heading: null, position: null, from: null };
    const s = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK, { track: sighting }), fix("f1", 40, "BRAVO 2")]);
    expect(s.units.find((u) => u.callsign === "BRAVO 2")).toMatchObject({ position: AT_MAIRIE, pending: { reportId: "q" } });
    expect(s.tracks[0].pendingReport).toBe("q");
    expect(decisionsOf(s).map((d) => d.id)).toEqual(["q"]);
  });

  it("leaves another unit's question open", () => {
    const s = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK), fix("f1", 40, "ALPHA 1")]);
    expect(decisionsOf(s).map((d) => d.id)).toEqual(["q"]);
  });
});

describe("placing a unit by hand on the coordinator", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fixes-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("places a roster unit at a place or a point, named from the gazetteer; the next report starts from there", async () => {
    const m = await createMission({ area: "vincennes", name: "By hand", start: null, roster: ["ALPHA 1", "BRAVO 2"] }, at(0));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const placed = await recordFix(code, { callsign: "ALPHA 1", where: { place: "way/83816816" }, radius_m: 25, note: "heard on the net" }, "CP", at(10));
    expect(placed).toMatchObject({ ok: true, entry: { kind: "fix", by: "CP", callsign: "ALPHA 1", position: { label: "Mairie de Vincennes" }, note: "heard on the net" } });
    const clicked = await recordFix(code, { callsign: "BRAVO 2", where: CHATEAU, radius_m: 100, note: null }, "CP", at(20));
    expect(clicked).toMatchObject({ ok: true, entry: { position: { label: "Château de Vincennes", radius_m: 100 } } });

    // Where the resolver measures the unit's next report from.
    const ctx = await reportContext(code, "BRAVO 2", { area: "vincennes", lastPosition: null }, at(30));
    expect(ctx).toMatchObject({ ok: true, atStart: false, lastPosition: { lat: CHATEAU.lat, lon: CHATEAU.lon, ts: at(20), radius_m: 100 } });

    // Never a unit that is not on the roster, and never a point in another town.
    expect(await recordFix(code, { callsign: "ZULU 9", where: CHATEAU, radius_m: 50, note: null }, "CP", at(40))).toMatchObject({ ok: false, status: 404, error: expect.stringContaining("roster") });
    expect(await recordFix(code, { callsign: "ALPHA 1", where: { lat: 50.45, lon: 30.52 }, radius_m: 50, note: null }, "CP", at(40))).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("outside") });
    expect(await recordFix(code, { callsign: "ALPHA 1", where: { place: "node/1" }, radius_m: 50, note: null }, "CP", at(40))).toMatchObject({ ok: false, status: 400 });

    await endMission(code, at(50));
    expect(await recordFix(code, { callsign: "ALPHA 1", where: CHATEAU, radius_m: 50, note: null }, "CP", at(60))).toMatchObject({ ok: false, ended: true });
    expect(await recordFix("no-such-mission", { callsign: "ALPHA 1", where: CHATEAU, radius_m: 50, note: null }, "CP", at(60))).toMatchObject({ ok: false, status: 404 });
  });

  it("the question the placement closed can no longer be answered", async () => {
    const m = await createMission({ area: "vincennes", name: "Closed", start: null, roster: ["BRAVO 2"] }, at(100));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const saved = await saveReport({ session: code, callsign: "BRAVO 2", seq: null, clientTs: null, area: "vincennes", transcript: "at the château", language: "en", intent: null, resolution: ASK, lastPosition: null, timings_ms: NO_TIME }, at(110));
    expect(await recordFix(code, { callsign: "BRAVO 2", where: MAIRIE, radius_m: 50, note: null }, "CP", at(120))).toMatchObject({ ok: true });
    expect(await recordAnswer(code, saved!.id, "castle/a", at(130), "CP")).toMatchObject({ ok: false, status: 409, error: "BRAVO 2 has been placed by hand since, so that question is closed." });
    const u = foldLog((await getStore().list(code)).entries).units.find((x) => x.callsign === "BRAVO 2")!;
    expect(u).toMatchObject({ position: { label: "Mairie de Vincennes" }, pending: null, placedBy: "CP" });
  });
});
