import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchCallsign } from "../lib/geo/callsigns";
import { splitRequest } from "../lib/geo/requests";
import type { Candidate, Resolution } from "../lib/geo/types";
import { colourMap, foldLog, UNIT_COLOURS } from "../lib/reports/fold";
import { missionRoster, startPosition, toLastPosition } from "../lib/reports/mission";
import { afterCallsign, farMove, findSender, REPLY_WINDOW_MS, withoutClosing } from "../lib/reports/radio";
import {
  addToRoster,
  createMission,
  deleteMission,
  dismissHeld,
  endMission,
  heldReport,
  reportContext,
  saveHeld,
  saveReport,
  type HeldInput,
  type ReportInput,
} from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import { rosterOf, type LogEntry, type ReportEntry, type StartPoint, type UnitPosition } from "../lib/reports/types";

const T0 = Date.UTC(2026, 10, 21, 18, 0, 0);
const at = (s: number) => T0 + s * 1000;
const S = "vincennes-1";
const START: StartPoint = { id: "castle/chateau", name: "Château de Vincennes", category: "castle", lat: 48.8427, lon: 2.4358, radius_m: 300 };
const TIMINGS = { stt: 0, extract: 0, resolve: 0, total: 0 };

function cand(id: string, name: string, lat: number, lon: number): Candidate {
  return { id, name, category: "metro_station", lat, lon, distance_m: 100, placement: { pin: { lat, lon }, radius_m: 30 } };
}
const BERAULT = cand("station/berault", "Bérault", 48.8456, 2.4285);
const MAIRIE = cand("town_hall/vincennes", "Mairie de Vincennes", 48.8476, 2.4392);
const ASK: Resolution = { status: "ambiguous", candidates: [BERAULT, MAIRIE], question: "Which one?", evidence: { rule: "ask", detail: "" } };
const RESOLVED: Resolution = { status: "resolved", pin: BERAULT.placement.pin, radius_m: 30, candidates: [BERAULT], evidence: { rule: "exact", feature_id: BERAULT.id, detail: "" } };
const AT_BERAULT: UnitPosition = { lat: BERAULT.lat, lon: BERAULT.lon, radius_m: 30, label: "Bérault" };
/** About 3 km north of Bérault. */
const FAR: UnitPosition = { lat: BERAULT.lat + 0.027, lon: BERAULT.lon, radius_m: 30, label: "far north" };

const mission: LogEntry = { kind: "mission", id: "m", session: S, ts: at(0), area: "vincennes", name: "Radio net", start: START, roster: ["ALPHA 1", "ALPHA 2", "BRAVO 2"] };

function report(id: string, callsign: string, ts: number, resolution: Resolution, position: UnitPosition | null, extra: Partial<ReportEntry> = {}): ReportEntry {
  return { kind: "report", id, session: S, callsign, seq: null, ts, clientTs: null, area: "vincennes", transcript: "", language: "en", intent: null, resolution, lastPosition: null, position, timings_ms: TIMINGS, ...extra };
}

describe("the roster", () => {
  it("is read from a list or from text, as call signs are stored", () => {
    expect(rosterOf("alpha 1, Alpha 2;\nbravo  2, ,ALPHA 1")).toEqual(["ALPHA 1", "ALPHA 2", "BRAVO 2"]);
    expect(rosterOf(["Сокіл", "", 3, "грім"])).toEqual(["СОКІЛ", "ГРІМ"]);
    expect(rosterOf(null)).toEqual([]);
  });

  it("is the mission's call signs, then those the operator added, then those that joined", () => {
    const log: LogEntry[] = [
      mission,
      { kind: "join", id: "j", session: S, callsign: "DELTA 4", ts: at(5), device: "phone-dddd", position: null },
      { kind: "roster", id: "r", session: S, ts: at(6), by: "CP", callsign: "CHARLIE 3" },
    ];
    expect(missionRoster(log)).toEqual(["ALPHA 1", "ALPHA 2", "BRAVO 2", "DELTA 4", "CHARLIE 3"]);
    const s = foldLog(log);
    expect(s.roster).toEqual(["ALPHA 1", "ALPHA 2", "BRAVO 2", "DELTA 4", "CHARLIE 3"]);
    // Every one is listed, the roster first; one not heard yet has lastHeard 0 and no position.
    expect(s.units.map((u) => [u.callsign, u.lastHeard])).toEqual([["ALPHA 1", 0], ["ALPHA 2", 0], ["BRAVO 2", 0], ["DELTA 4", at(5)], ["CHARLIE 3", 0]]);
    expect(s.units[0].position).toBeNull();
    // Colours go in roster order, so they stay the same however the reports come in.
    expect(colourMap(log).get("ALPHA 2")).toBe(UNIT_COLOURS[1]);
    expect(s.feed.find((f) => f.id === "r")).toMatchObject({ kind: "note", callsign: "CP", outcome: "Added CHARLIE 3 to the roster." });
  });
});

describe("who sent a radio report", () => {
  it("a call sign on the roster: that unit", () => {
    expect(findSender("Alpha 1, at the château", [mission], at(10))).toMatchObject({ kind: "unit", callsign: "ALPHA 1", sender: { heard: "Alpha 1", how: "exact" } });
    expect(findSender("Bravo too, at the station", [mission], at(10))).toMatchObject({ kind: "unit", callsign: "BRAVO 2", sender: { how: "near" } });
  });

  it("two roster entries close: held, asking which", () => {
    const f = findSender("Alpha, at the château", [mission], at(10));
    expect(f).toMatchObject({ kind: "held", reason: "which", candidates: ["ALPHA 1", "ALPHA 2"] });
    expect(f.kind === "held" && f.question).toBe("Heard “Alpha”. Which unit sent this: ALPHA 1 or ALPHA 2?");
  });

  it("a call sign at the end: held with that one unit to confirm, never given to it unasked [237]", () => {
    // A sign-off and speaking to a unit look the same, so a person says which.
    const f = findSender("At the château, Alpha 1, over.", [mission], at(10));
    expect(f).toMatchObject({ kind: "held", reason: "which", heard: "Alpha 1", candidates: ["ALPHA 1"] });
    expect(f.kind === "held" && f.question).toBe("Heard “Alpha 1” at the end. Was that ALPHA 1?");
    expect(findSender("Push up to the station and hold the north entrance, Bravo 2.", [mission], at(10))).toMatchObject({ kind: "held", candidates: ["BRAVO 2"] });
    // No pause before it: no suggestion either.
    expect(findSender("Linking up alongside Bravo 2.", [mission], at(10))).toMatchObject({ kind: "held", reason: "none", candidates: [] });
  });

  it("a call sign not on the roster checks in: held, never a new unit", () => {
    const f = findSender("Charlie 3, checking in", [mission], at(10));
    expect(f).toMatchObject({ kind: "held", reason: "unknown", read: "CHARLIE 3", candidates: [] });
    expect(f.kind === "held" && f.question).toMatch(/^CHARLIE 3 is not on the roster/);
    // Once a phone joins as CHARLIE 3, it is on the roster.
    const joined: LogEntry = { kind: "join", id: "j", session: S, callsign: "CHARLIE 3", ts: at(5), device: "phone-cccc", position: null };
    expect(findSender("Charlie 3, checking in", [mission, joined], at(10))).toMatchObject({ kind: "unit", callsign: "CHARLIE 3" });
  });

  it("the command post's own voice is held, not given to a unit", () => {
    const asked = report("r1", "ALPHA 1", at(100), ASK, null);
    const f = findSender("Alpha 1, this is base, report your position", [mission, asked], at(110));
    expect(f).toMatchObject({ kind: "held", reason: "none" });
    expect(f.kind === "held" && f.question).toMatch(/command post/);
  });

  it("no words: held", () => {
    expect(findSender("  ", [mission], at(10))).toMatchObject({ kind: "held", reason: "none", heard: null });
  });

  describe("no call sign said", () => {
    const asked = report("r1", "ALPHA 2", at(100), ASK, null);

    it("one unit's question is open and recent: it is that unit's reply", () => {
      expect(findSender("The second one", [mission, asked], at(150))).toMatchObject({ kind: "unit", callsign: "ALPHA 2", sender: { heard: null, how: "reply" } });
    });

    it("the question is older than two minutes: held", () => {
      expect(findSender("The second one", [mission, asked], at(100) + REPLY_WINDOW_MS + 1)).toMatchObject({ kind: "held", reason: "none" });
    });

    it("two units have one open: held, asking which", () => {
      const also = report("r2", "BRAVO 2", at(120), ASK, null);
      expect(findSender("The second one", [mission, asked, also], at(150))).toMatchObject({ kind: "held", reason: "which", candidates: ["ALPHA 2", "BRAVO 2"] });
    });

    it("no question open: held", () => {
      expect(findSender("At the château", [mission], at(150))).toMatchObject({ kind: "held", reason: "none", question: "No call sign heard. Which unit sent this?" });
    });
  });
});

describe("the words the model reads", () => {
  it("start after the sender's call sign, and any call before it", () => {
    expect(afterCallsign("Charlie 3, checking in, at the town hall.", "Charlie 3")).toBe("checking in, at the town hall.");
    expect(afterCallsign("Base, this is Alpha-1, at Bérault", "Alpha 1")).toBe("at Bérault");
    expect(afterCallsign("Alpha1 at the church", "Alpha 1")).toBe("at the church");
    expect(afterCallsign("Базо, я Грім, біля школи", "Грім")).toBe("біля школи");
  });

  it("are all of them with no call sign, or when it is not found", () => {
    expect(afterCallsign("The second one", null)).toBe("The second one");
    expect(afterCallsign("Alphabet soup", "Alpha")).toBe("Alphabet soup");
    expect(afterCallsign("Alpha 1.", "Alpha 1")).toBe("Alpha 1.");
  });

  it("are the words before a call sign said last, as a sign-off [237]", () => {
    expect(afterCallsign("At the town hall, Alpha 1, over.", "Alpha 1")).toBe("At the town hall");
    expect(afterCallsign("Track 1 is hostile. Charlie 3", "Charlie 3")).toBe("Track 1 is hostile");
    expect(afterCallsign("Moving towards the town hall, this is Bravo 2, over and out", "Bravo 2")).toBe("Moving towards the town hall");
    expect(afterCallsign("Contact, bearing 060, 300 metres, from Alpha 2, standing by.", "Alpha 2")).toBe("Contact, bearing 060, 300 metres");
    expect(afterCallsign("Біля школи, Сокіл, прийом.", "Сокіл")).toBe("Біля школи");
    // A call sign at the start with only "over" after it has nothing before it: as before.
    expect(afterCallsign("Alpha 1, over.", "Alpha 1")).toBe("over.");
  });

  it("stop before the words that close a transmission [237]", () => {
    // Left in, the offline model read "at Vincennes station, over." as no position (22 Nov).
    expect(afterCallsign("Alpha 1, at Vincennes station, over.", "Alpha 1")).toBe("at Vincennes station");
    expect(afterCallsign("Alpha 1, at Vincennes station over", "Alpha 1")).toBe("at Vincennes station");
    expect(afterCallsign("Bravo 2, moving towards the town hall, over and out.", "Bravo 2")).toBe("moving towards the town hall");
    expect(afterCallsign("Charlie 3, Track 1 is hostile. Out.", "Charlie 3")).toBe("Track 1 is hostile.");
    expect(afterCallsign("Alpha 1, at the church. Thank you.", "Alpha 1")).toBe("at the church.");
    expect(afterCallsign("Сокіл, біля школи, прийом.", "Сокіл")).toBe("біля школи");
    // "out" with no pause before it is part of the report.
    expect(afterCallsign("Alpha 1, moving out", "Alpha 1")).toBe("moving out");
    expect(afterCallsign("Alpha 1, the bridge is out.", "Alpha 1")).toBe("the bridge is out.");
    expect(withoutClosing("crossing over the bridge")).toBe("crossing over the bridge");
  });

  it("leave a request for recon and its track readable after a sign-off", () => {
    // The unit the operator is asked to confirm, and what is read once they do.
    const sender = (said: string) => {
      const m = matchCallsign(said, ["ALPHA 1", "BRAVO 2", "CHARLIE 3"]);
      if (m.kind !== "ask" || !m.signoff || m.candidates.length !== 1) throw new Error(`no sign-off in "${said}"`);
      return { callsign: m.candidates[0], split: splitRequest(afterCallsign(said, m.heard)) };
    };
    expect(sender("Unknown vehicle at the town hall, send the drone, Alpha 1, out.")).toEqual({
      callsign: "ALPHA 1",
      split: { text: "Unknown vehicle at the town hall", request: { words: "send the drone", n: null }, only: false },
    });
    // The call sign goes before the request clause is cut, so the track number is still read.
    expect(sender("Send the drone to Track 2. Alpha 1, over")).toMatchObject({ callsign: "ALPHA 1", split: { request: { n: 2 }, only: true } });
    expect(sender("Request eyes on Track 2, Charlie 3.")).toMatchObject({ callsign: "CHARLIE 3", split: { request: { n: 2 }, only: true } });
    // "eyes on Charlie 3" could be about Charlie 3, so this one waits for the operator: with
    // "request eyes on", the call sign goes first.
    expect(matchCallsign("Track 2, request eyes on, Charlie 3.", ["ALPHA 1", "BRAVO 2", "CHARLIE 3"]).kind).toBe("unassigned");
  });
});

describe("a move a unit could not have made", () => {
  const log: LogEntry[] = [
    mission,
    report("r1", "ALPHA 1", at(100), RESOLVED, AT_BERAULT),
    // ALPHA 2 is about 1 km from FAR, two minutes before: it could have got there.
    report("r2", "ALPHA 2", at(0), RESOLVED, { lat: FAR.lat - 0.009, lon: FAR.lon, radius_m: 30, label: "near" }),
  ];
  const last = toLastPosition(AT_BERAULT, at(100));

  it("3 km in 20 s is asked, naming who could have made it", () => {
    const f = farMove(log, "ALPHA 1", last, false, FAR, at(120));
    expect(f).toMatchObject({ others: ["ALPHA 2"] });
    expect(f?.question).toBe("ALPHA 1 moved 3.0 km in 20 s. Was that ALPHA 2?");
  });

  it("nobody else could have: asks if it is right", () => {
    expect(farMove(log.slice(0, 2), "ALPHA 1", last, false, FAR, at(120))?.question).toBe("ALPHA 1 moved 3.0 km in 20 s. Is that right?");
  });

  it("within 15 m/s, at the start point, or with no place: no question", () => {
    expect(farMove(log, "ALPHA 1", last, false, FAR, at(100 + 300))).toBeNull();
    expect(farMove(log, "ALPHA 1", toLastPosition(startPosition(START), at(100)), true, FAR, at(120))).toBeNull();
    expect(farMove(log, "ALPHA 1", last, false, null, at(120))).toBeNull();
    expect(farMove(log, "ALPHA 1", null, false, FAR, at(120))).toBeNull();
  });
});

describe("held reports in the log", () => {
  const held: LogEntry = {
    kind: "held",
    id: "h1",
    session: S,
    ts: at(50),
    clientTs: null,
    area: "vincennes",
    transcript: "Alpha, at Bérault",
    language: "en",
    reason: "which",
    heard: "Alpha",
    read: null,
    candidates: ["ALPHA 1", "ALPHA 2"],
    question: "Which?",
    audio: null,
  };

  it("wait in the tray and move nobody", () => {
    const s = foldLog([mission, held]);
    expect(s.held.map((h) => h.id)).toEqual(["h1"]);
    expect(s.units.every((u) => u.position == null && u.lastHeard === 0)).toBe(true);
    expect(s.feed).toHaveLength(0);
  });

  it("leave it when given to a unit, which then moves", () => {
    const given = report("r1", "ALPHA 1", at(60), RESOLVED, AT_BERAULT, { sender: { heard: "Alpha", how: "operator", held: "h1" } });
    const s = foldLog([mission, held, given]);
    expect(s.held).toHaveLength(0);
    expect(s.units.find((u) => u.callsign === "ALPHA 1")?.position?.label).toBe("Bérault");
    expect(s.feed[0]).toMatchObject({ kind: "report", sender: { how: "operator", held: "h1" } });
    // Replayed to before it was given, it waits again.
    expect(foldLog([mission, held, given], at(55)).held).toHaveLength(1);
  });

  it("leave it when dismissed, with a note in the feed", () => {
    const s = foldLog([mission, held, { kind: "dismiss", id: "d1", session: S, ts: at(70), by: "CP", held: "h1" }]);
    expect(s.held).toHaveLength(0);
    expect(s.feed[0]).toMatchObject({ kind: "note", outcome: "Dismissed a radio report: “Alpha, at Bérault”" });
  });
});

describe("held reports on the coordinator", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "radio-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const hold = (extra: Partial<HeldInput> = {}): HeldInput => ({
    session: S,
    clientTs: null,
    area: "vincennes",
    transcript: "Charlie 3, checking in",
    language: "en",
    reason: "unknown",
    heard: "Charlie 3",
    read: "CHARLIE 3",
    candidates: [],
    question: "CHARLIE 3 is not on the roster.",
    audio: null,
    ...extra,
  });
  const given = (callsign: string, held: string, resolution: Resolution = RESOLVED): ReportInput => ({
    session: S,
    callsign,
    seq: null,
    clientTs: null,
    area: "vincennes",
    transcript: "Charlie 3, checking in",
    language: "en",
    intent: null,
    resolution,
    lastPosition: null,
    timings_ms: TIMINGS,
    sender: { heard: "Charlie 3", how: "operator", held },
  });

  it("a mission opens with its roster", async () => {
    const r = await createMission({ area: "vincennes", name: "Radio net", start: START, roster: ["ALPHA 1", "ALPHA 2"] }, at(0));
    expect(r).toMatchObject({ ok: true, mission: { code: S, roster: ["ALPHA 1", "ALPHA 2"] } });
  });

  it("a held report keeps its recording", async () => {
    const h = await saveHeld(hold({ audio: { data: Buffer.from("RIFF0000WAVE"), ext: "wav" } }), at(10));
    expect(h?.audio).toBe(`${h?.id}.wav`);
    expect((await getStore().readAudio(S, h!.audio!))?.toString()).toBe("RIFF0000WAVE");
    expect(await heldReport(S, h!.id)).toMatchObject({ ok: true, entry: { reason: "unknown" }, settled: null });
    expect(await heldReport(S, "nope-1")).toMatchObject({ ok: false, status: 404 });
  });

  it("only the operator puts a unit on the roster; a report cannot go to one that is not", async () => {
    const h = await saveHeld(hold(), at(20));
    await expect(saveReport(given("CHARLIE 3", h!.id), at(21))).rejects.toThrow(/not on the roster/);
    expect(await addToRoster(S, "CHARLIE 3", "CP", h!.id, at(22))).toEqual({ ok: true, added: true });
    expect(await addToRoster(S, "CHARLIE 3", "CP", null, at(23))).toEqual({ ok: true, added: false });
    const first = await saveReport(given("CHARLIE 3", h!.id), at(24));
    expect(first?.already).toBeUndefined();
    // The first decision stands: given again, or dismissed, nothing new is written.
    const again = await saveReport(given("ALPHA 1", h!.id), at(25));
    expect(again).toMatchObject({ id: first!.id, already: true });
    expect(await dismissHeld(S, h!.id, "CP", at(26))).toEqual({ ok: true, already: true });
    const { entries } = await getStore().list(S);
    const s = foldLog(entries);
    expect(s.held.map((x) => x.id)).not.toContain(h!.id);
    expect(s.units.find((u) => u.callsign === "CHARLIE 3")?.position?.label).toBe("Bérault");
  });

  it("a dismissed report cannot then be given to a unit", async () => {
    const h = await saveHeld(hold({ reason: "none", heard: null, read: null }), at(30));
    expect(await dismissHeld(S, h!.id, "CP", at(31))).toEqual({ ok: true, already: false });
    expect(await saveReport(given("ALPHA 1", h!.id), at(32))).toMatchObject({ already: true });
    const { entries } = await getStore().list(S);
    expect(entries.filter((e) => e.kind === "report" && e.callsign === "ALPHA 1")).toHaveLength(0);
  });

  it("a held report given later is read from where the unit was when it came in", async () => {
    await saveReport({ ...given("ALPHA 2", ""), sender: { heard: "Alpha 2", how: "exact" } }, at(40));
    await saveReport({ ...given("ALPHA 2", ""), sender: { heard: "Alpha 2", how: "exact" }, resolution: { ...RESOLVED, pin: { lat: FAR.lat, lon: FAR.lon } } }, at(400));
    const then = await reportContext(S, "ALPHA 2", { area: "vincennes", lastPosition: null }, at(100), at(100));
    expect(then).toMatchObject({ ok: true, atStart: false, lastPosition: { lat: BERAULT.lat, ts: at(40) } });
    const now = await reportContext(S, "ALPHA 2", { area: "vincennes", lastPosition: null }, at(500));
    expect(now).toMatchObject({ ok: true, lastPosition: { lat: FAR.lat, ts: at(400) } });
  });

  it("a deleted mission takes its recordings with it", async () => {
    expect(await readdir(path.join(dir, "audio"))).toContain(S);
    await endMission(S, at(600));
    expect(await deleteMission(S)).toEqual({ ok: true });
    expect(await readdir(path.join(dir, "audio"))).not.toContain(S);
    expect((await readdir(path.join(dir, "deleted"))).filter((f) => f.endsWith(".audio"))).toHaveLength(1);
  });
});
