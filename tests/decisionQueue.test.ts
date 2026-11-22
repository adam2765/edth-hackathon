import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Candidate, Resolution } from "../lib/geo/types";
import { decisionsOf, optionsOf } from "../lib/reports/decisions";
import { foldLog } from "../lib/reports/fold";
import { createMission, recordAnswer, saveReport } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import type { AnswerEntry, HeldEntry, LogEntry, ReportEntry, RequestEntry, TrackSighting, UnitPosition } from "../lib/reports/types";

// The command post's Decisions list [239]: what waits on the operator, and when it stops waiting.

const T0 = Date.UTC(2026, 10, 22, 9, 0, 0);
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
const AT_MAIRIE: UnitPosition = { lat: MAIRIE.lat, lon: MAIRIE.lon, radius_m: 30, label: "Mairie de Vincennes" };

const MISSION: LogEntry = { kind: "mission", id: "m", session: S, ts: at(0), area: "vincennes", name: "Busy net", start: null, roster: ["ALPHA 1", "ALPHA 2", "BRAVO 1"] };

function report(id: string, s: number, callsign: string, resolution: Resolution, extra: Partial<ReportEntry> = {}): ReportEntry {
  return { kind: "report", id, session: S, callsign, seq: null, ts: at(s), clientTs: null, area: "vincennes", transcript: id, language: "en", intent: null, resolution, lastPosition: null, position: null, timings_ms: NO_TIME, ...extra };
}

function answer(id: string, s: number, callsign: string, reportId: string, choice: string | null, position: UnitPosition | null = null): AnswerEntry {
  return { kind: "answer", id, session: S, callsign, ts: at(s), report_id: reportId, choice, position, by: "CP" };
}

function held(id: string, s: number, extra: Partial<HeldEntry> = {}): HeldEntry {
  return { kind: "held", id, session: S, ts: at(s), clientTs: null, area: "vincennes", transcript: "at the station, over", language: "en", reason: "which", heard: null, read: null, candidates: ["ALPHA 1", "ALPHA 2"], question: "Which unit?", audio: null, ...extra };
}

describe("a question closes when its unit reports again", () => {
  it("a new place overtakes the open question: it leaves the list and says so in the feed", () => {
    const log = [MISSION, report("q", 10, "ALPHA 1", ASK), report("fix", 40, "ALPHA 1", PLACED, { position: AT_MAIRIE })];
    const s = foldLog(log);
    expect(s.units.find((u) => u.callsign === "ALPHA 1")?.pending).toBeNull();
    expect(s.feed.find((f) => f.id === "q")).toMatchObject({ overtaken: true, outcome: expect.stringMatching(/Overtaken by a later report\.$/) });
    expect(decisionsOf(s)).toEqual([]);
  });

  it("a second question overtakes the first; only the second waits", () => {
    const s = foldLog([MISSION, report("q1", 10, "ALPHA 1", ASK), report("q2", 20, "ALPHA 1", ASK)]);
    expect(s.feed.find((f) => f.id === "q1")?.overtaken).toBe(true);
    expect(decisionsOf(s).map((d) => d.id)).toEqual(["q2"]);
  });

  it("a report about a track leaves the question open: the unit still owes the answer", () => {
    const sighting: TrackSighting = { n: 1, affiliation: "hostile", kind: "vehicle", count: null, text: "enemy vehicle", heading: null, position: AT_MAIRIE, from: null };
    const s = foldLog([MISSION, report("q", 10, "ALPHA 1", ASK), report("seen", 20, "ALPHA 1", PLACED, { track: sighting })]);
    expect(decisionsOf(s).map((d) => d.id)).toEqual(["q"]);
  });

  it("another unit's report changes nothing", () => {
    const s = foldLog([MISSION, report("q", 10, "ALPHA 1", ASK), report("fix", 20, "ALPHA 2", PLACED, { position: AT_MAIRIE })]);
    expect(decisionsOf(s).map((d) => d.id)).toEqual(["q"]);
  });

  it("an answer that came after the unit reported again moves nothing (logs from before the coordinator refused it)", () => {
    const castleFix: UnitPosition = { lat: CHATEAU.lat, lon: CHATEAU.lon, radius_m: 30, label: "Château de Vincennes" };
    const s = foldLog([MISSION, report("q", 10, "ALPHA 1", ASK), report("fix", 20, "ALPHA 1", PLACED, { position: AT_MAIRIE }), answer("a", 30, "ALPHA 1", "q", "castle/a", castleFix)]);
    expect(s.units.find((u) => u.callsign === "ALPHA 1")?.position?.label).toBe("Mairie de Vincennes");
    expect(s.feed.find((f) => f.id === "q")?.outcome).toBe("CP chose Château de Vincennes. The unit had reported again, so nothing moved.");
  });
});

describe("a question with no choices waits for the operator too", () => {
  it("is a decision of its own, and its unit reads as awaiting an answer", () => {
    const s = foldLog([MISSION, report("far", 10, "ALPHA 1", HOW_FAR)]);
    expect(decisionsOf(s)).toMatchObject([{ kind: "prompt", id: "far", callsign: "ALPHA 1" }]);
    expect(s.units.find((u) => u.callsign === "ALPHA 1")?.prompt).toMatchObject({ reportId: "far", question: HOW_FAR.question });
  });

  it("any later report from the unit overtakes it, a report about a track as well", () => {
    const sighting: TrackSighting = { n: 1, affiliation: "hostile", kind: "vehicle", count: null, text: "enemy vehicle", heading: null, position: AT_MAIRIE, from: null };
    const s = foldLog([MISSION, report("far", 10, "ALPHA 1", HOW_FAR), report("seen", 20, "ALPHA 1", PLACED, { track: sighting })]);
    expect(decisionsOf(s)).toEqual([]);
    expect(s.feed.find((f) => f.id === "far")?.overtaken).toBe(true);
  });

  it("the command post closes it; nothing moves", () => {
    const s = foldLog([MISSION, report("far", 10, "ALPHA 1", HOW_FAR), answer("a", 20, "ALPHA 1", "far", null)]);
    expect(decisionsOf(s)).toEqual([]);
    expect(s.feed.find((f) => f.id === "far")).toMatchObject({ answer: { by: "CP", choice: null }, outcome: `Closed by CP: ${HOW_FAR.question}` });
    expect(s.units.find((u) => u.callsign === "ALPHA 1")?.position).toBeNull();
  });

  it("ending the mission closes it", () => {
    const s = foldLog([MISSION, report("far", 10, "ALPHA 1", HOW_FAR), { kind: "end", id: "e", session: S, ts: at(30) }]);
    expect(decisionsOf(s)).toEqual([]);
    expect(s.feed.find((f) => f.id === "far")?.expired).toBe(true);
  });
});

describe("the list", () => {
  it("holds questions, prompts, held radio reports and recon requests, oldest first", () => {
    const req: RequestEntry = { kind: "request", id: "r", session: S, ts: at(15), callsign: "BRAVO 1", n: null, words: "request eyes on", report_id: null };
    const s = foldLog([MISSION, report("q", 30, "ALPHA 1", ASK), held("h", 5), req, report("far", 20, "ALPHA 2", HOW_FAR)]);
    expect(decisionsOf(s).map((d) => `${d.kind}:${d.id}`)).toEqual(["held:h", "request:r", "prompt:far", "question:q"]);
  });

  it("numbers a question's choices for the keys, with none of these on N", () => {
    const [d] = decisionsOf(foldLog([MISSION, report("q", 10, "ALPHA 1", ASK)]));
    expect(optionsOf(d, [])).toEqual({
      numbered: [
        { kind: "choice", choice: "castle/a", name: "Château de Vincennes" },
        { kind: "choice", choice: "town_hall/b", name: "Mairie de Vincennes" },
      ],
      drop: { kind: "choice", choice: null, name: "" },
    });
  });

  it("numbers a held report's units on the roster, then the call sign heard when it is not on it", () => {
    const s = foldLog([MISSION, held("h", 5, { reason: "unknown", read: "CHARLIE 3", candidates: ["ALPHA 2", "DELTA 9"] })]);
    expect(optionsOf(decisionsOf(s)[0], s.roster)).toEqual({
      numbered: [
        { kind: "held", action: "assign", callsign: "ALPHA 2" },
        { kind: "held", action: "add", callsign: "CHARLIE 3" },
      ],
      drop: { kind: "held", action: "dismiss", callsign: null },
    });
  });

  it("a prompt can only be closed, and a request keeps its own controls", () => {
    const req: RequestEntry = { kind: "request", id: "r", session: S, ts: at(15), callsign: "BRAVO 1", n: null, words: "request eyes on", report_id: null };
    const [prompt, request] = decisionsOf(foldLog([MISSION, report("far", 10, "ALPHA 1", HOW_FAR), req]));
    expect(optionsOf(prompt, [])).toEqual({ numbered: [], drop: { kind: "close" } });
    expect(optionsOf(request, [])).toEqual({ numbered: [], drop: null });
  });
});

describe("the coordinator answers only a question that still waits", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "decisions-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const save = (code: string, callsign: string, resolution: Resolution, s: number) =>
    saveReport({ session: code, callsign, seq: null, clientTs: null, area: "vincennes", transcript: "words", language: "en", intent: null, resolution, lastPosition: null, timings_ms: NO_TIME }, at(s));

  it("refuses a question the unit has moved past, and a report that asked nothing", async () => {
    const m = await createMission({ area: "vincennes", name: "Answers", start: null }, at(0));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const asked = await save(code, "ALPHA 1", ASK, 10);
    const placed = await save(code, "ALPHA 1", { ...PLACED, pin: MAIRIE, radius_m: 30 }, 20);
    expect(await recordAnswer(code, asked!.id, "castle/a", at(30), "CP")).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("reported again") });
    expect(await recordAnswer(code, placed!.id, null, at(31), "CP")).toMatchObject({ ok: false, status: 400 });
  });

  it("closes a question with no choices, and refuses a choice for one", async () => {
    const m = await createMission({ area: "vincennes", name: "Prompts", start: null }, at(100));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const far = await save(code, "ALPHA 2", HOW_FAR, 110);
    expect(await recordAnswer(code, far!.id, "castle/a", at(120), "CP")).toMatchObject({ ok: false, status: 400 });
    expect(await recordAnswer(code, far!.id, null, at(121), "CP")).toMatchObject({ ok: true, entry: { by: "CP", choice: null, position: null } });
    expect(decisionsOf(foldLog((await getStore().list(code)).entries))).toEqual([]);
  });
});
