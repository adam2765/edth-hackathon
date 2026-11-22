import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Candidate, Resolution } from "../lib/geo/types";
import { decisionsOf } from "../lib/reports/decisions";
import { foldLog } from "../lib/reports/fold";
import { answerHeard } from "../lib/reports/pipeline";
import { createMission, recordAnswer, saveReply, saveReport } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import type { AnswerEntry, LogEntry, ReplyEntry, ReportEntry, UnitPosition } from "../lib/reports/types";

// An answer heard for an open question [244]: kept in the log, shown picked, confirmed by a person.

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
const at = (s: number) => T0 + s * 1000;
const S = "vincennes-1";
const STATION = { lat: 48.84449, lon: 2.44052 };
const CASTLE = { lat: 48.84276, lon: 2.43589 };
const NO_TIME = { stt: 0, extract: 0, resolve: 0, total: 0 };

const station: Candidate = { id: "node/9863472112", name: "Château de Vincennes", category: "metro_station", lat: STATION.lat, lon: STATION.lon, distance_m: 304, placement: { pin: STATION, radius_m: 30 } };
const castle: Candidate = { id: "way/23032971", name: "Château de Vincennes", category: "castle", lat: CASTLE.lat, lon: CASTLE.lon, distance_m: 312, placement: { pin: CASTLE, radius_m: 30 } };
const ASK: Resolution = { status: "ambiguous", candidates: [station, castle], question: "Which one: Château de Vincennes (station), or Château de Vincennes (castle)?", evidence: { rule: "ask", detail: "" } };
const PLACED: Resolution = { status: "resolved", candidates: [], evidence: { rule: "exact", detail: "" } };
const AT_CASTLE: UnitPosition = { lat: CASTLE.lat, lon: CASTLE.lon, radius_m: 30, label: "Château de Vincennes" };

const MISSION: LogEntry = { kind: "mission", id: "m", session: S, ts: at(0), area: "vincennes", name: "Answers", start: null, roster: ["ALPHA 1", "BRAVO 2"] };

function report(id: string, s: number, callsign: string, resolution: Resolution, extra: Partial<ReportEntry> = {}): ReportEntry {
  return { kind: "report", id, session: S, callsign, seq: null, ts: at(s), clientTs: null, area: "vincennes", transcript: id, language: "en", intent: null, resolution, lastPosition: null, position: null, timings_ms: NO_TIME, ...extra };
}

function reply(id: string, s: number, callsign: string, reportId: string, choice: string, transcript: string, how: ReplyEntry["how"] = "name"): ReplyEntry {
  return { kind: "reply", id, session: S, callsign, ts: at(s), clientTs: null, report_id: reportId, transcript, language: "en", choice, how };
}

describe("an answer heard, in the log", () => {
  it("marks the open question, moves nothing, and stays in the Decisions list for the confirm", () => {
    const s = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK), reply("a", 30, "BRAVO 2", "q", station.id, "Bravo 2, the metro station.")]);
    const u = s.units.find((x) => x.callsign === "BRAVO 2")!;
    // The unit spoke, so it was heard. It has not moved, and its question is still open.
    expect(u).toMatchObject({ lastHeard: at(30), position: null, pending: { reportId: "q" } });
    expect(s.feed.find((f) => f.id === "q")?.heard).toEqual({ ts: at(30), choice: station.id, n: 1, name: "Château de Vincennes", words: "Bravo 2, the metro station.", how: "name" });
    expect(decisionsOf(s).map((d) => d.id)).toEqual(["q"]);
    expect(s.feed[0]).toMatchObject({ kind: "reply", callsign: "BRAVO 2", outcome: "Said “Bravo 2, the metro station.”: heard as choice 1, Château de Vincennes (metro station). The command post confirms." });
  });

  it("the latest answer heard replaces an earlier one", () => {
    const s = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK), reply("a1", 30, "BRAVO 2", "q", station.id, "one", "number"), reply("a2", 40, "BRAVO 2", "q", castle.id, "the castle")]);
    expect(s.feed.find((f) => f.id === "q")?.heard).toMatchObject({ choice: castle.id, n: 2, words: "the castle" });
  });

  it("the confirm is an answer like any other: the unit moves then, and the feed says who chose", () => {
    const answer: AnswerEntry = { kind: "answer", id: "ans", session: S, callsign: "BRAVO 2", ts: at(50), report_id: "q", choice: castle.id, position: AT_CASTLE, by: "CP" };
    const s = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK), reply("a", 30, "BRAVO 2", "q", castle.id, "the castle"), answer]);
    expect(s.units.find((x) => x.callsign === "BRAVO 2")).toMatchObject({ position: AT_CASTLE, pending: null });
    expect(s.feed.find((f) => f.id === "q")?.outcome).toMatch(/^CP chose Château de Vincennes\./);
    expect(decisionsOf(s)).toEqual([]);
  });

  it("is not kept against a question that is closed, or a choice that was not offered", () => {
    const moved = report("r2", 20, "BRAVO 2", PLACED, { position: AT_CASTLE });
    const late = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK), moved, reply("a", 30, "BRAVO 2", "q", station.id, "the metro")]);
    expect(late.feed.find((f) => f.id === "q")?.heard).toBeUndefined();
    const other = foldLog([MISSION, report("q", 10, "BRAVO 2", ASK), reply("a", 30, "BRAVO 2", "q", "way/1", "the park")]);
    expect(other.feed.find((f) => f.id === "q")?.heard).toBeUndefined();
  });

  it("a unit placed by hand closes its question, answer heard or not [243]", () => {
    const s = foldLog([
      MISSION,
      report("q", 10, "BRAVO 2", ASK),
      reply("a", 30, "BRAVO 2", "q", station.id, "the metro"),
      { kind: "fix", id: "f", session: S, ts: at(40), by: "CP", callsign: "BRAVO 2", position: AT_CASTLE },
    ]);
    expect(s.units.find((x) => x.callsign === "BRAVO 2")).toMatchObject({ position: AT_CASTLE, placedBy: "CP", pending: null });
    expect(s.feed.find((f) => f.id === "q")).toMatchObject({ overtaken: true, byHand: true });
    expect(decisionsOf(s)).toEqual([]);
  });
});

describe("telling an answer from a report", () => {
  const log = [MISSION, report("q", 10, "BRAVO 2", ASK)];

  it("a few words that pick one choice of the unit's open question are an answer", () => {
    expect(answerHeard(log, "BRAVO 2", "the metro station", at(20))).toMatchObject({ report_id: "q", n: 1, how: "name", candidate: { id: station.id } });
    expect(answerHeard(log, "BRAVO 2", "two", at(20))).toMatchObject({ n: 2, how: "number", candidate: { id: castle.id } });
  });

  it("a sentence of its own, a unit with no question, or a question already closed is not", () => {
    expect(answerHeard(log, "BRAVO 2", "I'm at the castle", at(20))).toBeNull();
    expect(answerHeard(log, "BRAVO 2", "two blocks east", at(20))).toBeNull();
    // ALPHA 1 has no open question: "two" answers nothing.
    expect(answerHeard(log, "ALPHA 1", "two", at(20))).toBeNull();
    expect(answerHeard([...log, report("r2", 15, "BRAVO 2", PLACED, { position: AT_CASTLE })], "BRAVO 2", "two", at(20))).toBeNull();
  });
});

describe("keeping an answer heard on the coordinator", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "heard-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves it for the unit's open question, and the command post's confirm then places the unit", async () => {
    const m = await createMission({ area: "vincennes", name: "Heard", start: null, roster: ["BRAVO 2"] }, at(0));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const asked = await saveReport({ session: code, callsign: "BRAVO 2", seq: null, clientTs: null, area: "vincennes", transcript: "Bravo 2, at the château.", language: "en", intent: null, resolution: ASK, lastPosition: null, timings_ms: NO_TIME }, at(10));
    const base = { session: code, callsign: "BRAVO 2", clientTs: null, report_id: asked!.id, transcript: "Bravo 2, the castle.", language: "en", how: "name" as const };

    // Not a choice of that question, or not that unit's open question: nothing is kept.
    expect(await saveReply({ ...base, choice: "way/1" }, at(20))).toBeNull();
    expect(await saveReply({ ...base, report_id: "nope", choice: castle.id }, at(20))).toBeNull();

    const saved = await saveReply({ ...base, choice: castle.id, sender: { heard: "Bravo 2", how: "exact" } }, at(20));
    expect(saved).toMatchObject({ kind: "reply", callsign: "BRAVO 2", report_id: asked!.id, choice: castle.id, how: "name", sender: { how: "exact" } });
    let s = foldLog((await getStore().list(code)).entries);
    expect(s.units[0]).toMatchObject({ position: null, pending: { reportId: asked!.id } });
    expect(s.feed.find((f) => f.id === asked!.id)?.heard).toMatchObject({ n: 2, words: "Bravo 2, the castle." });

    // The operator confirms: an ordinary answer by the command post.
    expect(await recordAnswer(code, asked!.id, castle.id, at(30), "CP")).toMatchObject({ ok: true, entry: { by: "CP", choice: castle.id } });
    s = foldLog((await getStore().list(code)).entries);
    expect(s.units[0]).toMatchObject({ position: { label: "Château de Vincennes" }, pending: null });

    // Answered: a later "the metro" is no longer an answer to keep.
    expect(await saveReply({ ...base, choice: station.id }, at(40))).toBeNull();
  });
});
