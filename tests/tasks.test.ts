import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Resolution } from "../lib/geo/types";
import { foldLog } from "../lib/reports/fold";
import { createMission, endMission, recordPlot, recordTask, saveReport, saveRequest } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import { parseTask } from "../lib/reports/tasks";
import type { LogEntry, PlotEntry, RequestEntry, TaskEntry } from "../lib/reports/types";

const T0 = Date.UTC(2026, 10, 21, 20, 30, 0);
const at = (s: number) => T0 + s * 1000;
const SESSION = "vincennes-1";
const MAIRIE = { lat: 48.84765, lon: 2.43977 };
const MONTREUIL = { lat: 48.8513, lon: 2.4318 };

const MISSION: LogEntry = { kind: "mission", id: "m", session: SESSION, ts: at(0), area: "vincennes", name: "Recon", start: null, roster: ["ALPHA 1"] };
const where = (p: { lat: number; lon: number }, label: string) => ({ ...p, radius_m: 50, label });

function place(id: string, s: number, n: number, e: Partial<PlotEntry>): PlotEntry {
  return { kind: "plot", id, session: SESSION, ts: at(s), by: "CP", action: "place", n, count: null, position: where(MAIRIE, "Mairie de Vincennes"), ...e };
}
function request(id: string, s: number, n: number | null, words = "send the drone"): RequestEntry {
  return { kind: "request", id, session: SESSION, ts: at(s), callsign: "ALPHA 1", n, words, report_id: null };
}
function task(id: string, s: number, e: Omit<TaskEntry, "kind" | "id" | "session" | "ts" | "by">): TaskEntry {
  return { kind: "task", id, session: SESSION, ts: at(s), by: "CP", ...e };
}

// Track 1 a friendly drone team, Track 2 an unknown vehicle, Track 3 a hostile drone.
const MAP: LogEntry[] = [
  MISSION,
  place("p1", 10, 1, { affiliation: "friendly", track_kind: "drone_team", position: where(MONTREUIL, "Rue de Montreuil") }),
  place("p2", 20, 2, { affiliation: "unknown", track_kind: "vehicle" }),
  place("p3", 30, 3, { affiliation: "hostile", track_kind: "drone" }),
];

describe("checking what the command post sent", () => {
  it("send needs the drone and the track; done the drone; decline the request", () => {
    expect(parseTask({ action: "send", asset: 1, n: 2 })).toEqual({ ok: true, input: { action: "send", asset: 1, n: 2, request: null } });
    expect(parseTask({ action: "send", asset: 1, n: 2, request: "abc-123" })).toMatchObject({ ok: true, input: { request: "abc-123" } });
    expect(parseTask({ action: "done", asset: 1 })).toEqual({ ok: true, input: { action: "done", asset: 1 } });
    expect(parseTask({ action: "decline", request: "abc-123" })).toEqual({ ok: true, input: { action: "decline", request: "abc-123" } });
    expect(parseTask({ action: "send", asset: 1 })).toMatchObject({ ok: false });
    expect(parseTask({ action: "decline" })).toMatchObject({ ok: false });
    expect(parseTask({ action: "engage", asset: 1, n: 2 })).toMatchObject({ ok: false });
    expect(parseTask({ action: "send", asset: 1, n: 2, request: "../x" })).toMatchObject({ ok: false });
  });
});

describe("requests and tasks in the log", () => {
  it("a request waits until a drone is sent to its track", () => {
    const log = [...MAP, request("r1", 40, 2), task("t1", 50, { action: "send", asset: 1, n: 2, request: "r1" })];
    const before = foldLog(log, at(45));
    expect(before.requests).toMatchObject([{ id: "r1", callsign: "ALPHA 1", n: 2, words: "send the drone" }]);
    expect(before.tracks[0].task).toBeNull();

    const after = foldLog(log);
    expect(after.requests).toEqual([]);
    expect(after.tracks.find((t) => t.n === 1)?.task).toMatchObject({ n: 2, ts: at(50), by: "CP" });
    expect(after.tracks.find((t) => t.n === 2)?.recon).toEqual([{ asset: 1, ts: at(50) }]);
    expect(after.feed.find((f) => f.id === "r1")).toMatchObject({ kind: "request", outcome: "Asked for recon on Track 2: “send the drone” CP sent Track 1.", track: 2 });
    expect(after.feed.find((f) => f.id === "t1")).toMatchObject({ kind: "task", callsign: "CP", outcome: "Sent Track 1 (friendly drone team) to look at Track 2. ALPHA 1 had asked.", track: 2 });
  });

  it("a drone sent elsewhere moves; done ends it; a send answers every request on that track", () => {
    const log = [
      ...MAP,
      task("t1", 40, { action: "send", asset: 1, n: 2 }),
      request("r1", 50, 3),
      request("r2", 55, 3, "request eyes on"),
      task("t2", 60, { action: "send", asset: 1, n: 3 }),
    ];
    const s = foldLog(log);
    expect(s.requests).toEqual([]);
    expect(s.tracks.find((t) => t.n === 2)?.recon).toEqual([]);
    expect(s.tracks.find((t) => t.n === 3)?.recon).toEqual([{ asset: 1, ts: at(60) }]);
    expect(s.feed.find((f) => f.id === "t2")?.outcome).toBe("Sent Track 1 (friendly drone team) to look at Track 3, instead of Track 2.");

    const done = foldLog([...log, task("t3", 70, { action: "done", asset: 1 })]);
    expect(done.tracks.find((t) => t.n === 1)?.task).toBeNull();
    expect(done.tracks.find((t) => t.n === 3)?.recon).toEqual([]);
    expect(done.feed.find((f) => f.id === "t3")?.outcome).toBe("Track 1 (friendly drone team): recon of Track 3 done.");
  });

  it("a declined request closes; the end of the mission closes the rest and every task", () => {
    const log = [...MAP, request("r1", 40, null), request("r2", 45, 2), task("t1", 50, { action: "decline", request: "r1" }), task("t2", 55, { action: "send", asset: 1, n: 3 })];
    const s = foldLog(log);
    expect(s.requests.map((r) => r.id)).toEqual(["r2"]);
    expect(s.feed.find((f) => f.id === "t1")?.outcome).toBe("Declined ALPHA 1’s request for recon: “send the drone”");

    const ended = foldLog([...log, { kind: "end", id: "e", session: SESSION, ts: at(60) }]);
    expect(ended.requests).toEqual([]);
    expect(ended.tracks.every((t) => t.task === null && t.recon.length === 0)).toBe(true);
    expect(ended.feed.find((f) => f.id === "r2")).toMatchObject({ expired: true, outcome: expect.stringMatching(/Not answered before the mission ended\.$/) });
  });

  it("a request is the unit being heard", () => {
    const s = foldLog([...MAP, request("r1", 40, 2)]);
    expect(s.units.find((u) => u.callsign === "ALPHA 1")?.lastHeard).toBe(at(40));
  });
});

describe("recon on the coordinator", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tasks-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const timings = { stt: 0, extract: 0, resolve: 0, total: 0 };
  /** A report that opens a new unknown vehicle track at the Mairie. */
  const vehicle: Resolution = {
    status: "resolved",
    candidates: [],
    evidence: { rule: "exact", detail: "" },
    track: { n: null, opened: true, affiliation: null, kind: "vehicle", count: null, text: "unknown vehicle", heading: null, placement: { pin: MAIRIE, radius_m: 80 }, label: "Mairie de Vincennes", say: "" },
  } as Resolution;

  it("a report with a request saves both; the request is about the track the report opened", async () => {
    const m = await createMission({ area: "vincennes", name: "Recon", start: null, roster: ["ALPHA 1"] }, at(0));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const drone = await recordPlot(code, { action: "place", affiliation: "friendly", track_kind: "drone_team", count: null, where: MONTREUIL, radius_m: 50, note: null }, "CP", at(10));
    expect(drone).toMatchObject({ ok: true, entry: { n: 1 } });

    const saved = await saveReport(
      { session: code, callsign: "ALPHA 1", seq: 1, clientTs: at(19), area: "vincennes", transcript: "ALPHA 1, unknown vehicle at Mairie de Vincennes, send the drone", language: "en", intent: null, resolution: vehicle, lastPosition: null, timings_ms: timings, request: { words: "send the drone", n: null }, read: "unknown vehicle at Mairie de Vincennes" },
      at(20),
    );
    expect(saved).toMatchObject({ resolution: { track: { n: 2 } }, request: { n: 2 } });
    const entries = (await getStore().list(code)).entries;
    const report = entries.find((e) => e.kind === "report")!;
    // The request is an entry of its own, not a field on the report.
    expect(report).not.toHaveProperty("request");
    expect(report).not.toHaveProperty("read");
    expect(entries.find((e) => e.kind === "request")).toMatchObject({ callsign: "ALPHA 1", n: 2, words: "send the drone", report_id: report.id });

    // The same report sent twice asks once.
    await saveReport({ session: code, callsign: "ALPHA 1", seq: 1, clientTs: at(19), area: "vincennes", transcript: "again", language: "en", intent: null, resolution: vehicle, lastPosition: null, timings_ms: timings, request: { words: "send the drone", n: null } }, at(21));
    expect((await getStore().list(code)).entries.filter((e) => e.kind === "request")).toHaveLength(1);

    // A request on its own names its track; a number the mission does not have names none.
    expect(await saveRequest({ session: code, callsign: "ALPHA 1", words: "request eyes on", n: 2 }, at(30))).toMatchObject({ n: 2, report_id: null });
    expect(await saveRequest({ session: code, callsign: "ALPHA 1", words: "request eyes on", n: 9 }, at(31))).toMatchObject({ n: null });
    await expect(saveRequest({ session: code, callsign: "ZULU 9", words: "send the drone", n: null, sender: { heard: "Zulu nine", how: "exact" } }, at(32))).rejects.toThrow(/roster/);
  });

  it("only a friendly drone or drone team is sent, to a track on the map; the first decision stands", async () => {
    const m = await createMission({ area: "vincennes", name: "Tasks", start: null, roster: ["ALPHA 1"] }, at(100));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const put = (affiliation: "friendly" | "hostile", track_kind: "drone_team" | "drone" | "vehicle", s: number) =>
      recordPlot(code, { action: "place", affiliation, track_kind, count: null, where: MAIRIE, radius_m: 50, note: null }, "CP", at(s));
    await put("friendly", "drone_team", 110); // 1
    await put("hostile", "drone", 111); // 2
    await put("friendly", "vehicle", 112); // 3
    await put("friendly", "drone", 113); // 4
    const asked = await saveRequest({ session: code, callsign: "ALPHA 1", words: "send the drone", n: 2 }, at(120));

    expect(await recordTask(code, { action: "send", asset: 2, n: 1, request: null }, "CP", at(130))).toMatchObject({ ok: false, status: 400, error: "Track 2 is not a friendly drone or drone team." });
    expect(await recordTask(code, { action: "send", asset: 3, n: 2, request: null }, "CP", at(130))).toMatchObject({ ok: false, status: 400 });
    expect(await recordTask(code, { action: "send", asset: 1, n: 1, request: null }, "CP", at(130))).toMatchObject({ ok: false, status: 400 });
    expect(await recordTask(code, { action: "send", asset: 1, n: 9, request: null }, "CP", at(130))).toMatchObject({ ok: false, status: 404 });
    expect(await recordTask(code, { action: "done", asset: 1 }, "CP", at(130))).toMatchObject({ ok: false, status: 400 });
    expect(await recordTask(code, { action: "decline", request: "zzz-000" }, "CP", at(130))).toMatchObject({ ok: false, status: 404 });

    await recordPlot(code, { action: "gone", n: 4 }, "CP", at(135));
    expect(await recordTask(code, { action: "send", asset: 4, n: 2, request: null }, "CP", at(136))).toMatchObject({ ok: false, error: "Track 4 is marked gone." });

    const sent = await recordTask(code, { action: "send", asset: 1, n: 2, request: asked!.id }, "CP", at(140));
    expect(sent).toMatchObject({ ok: true, already: false, entry: { action: "send", asset: 1, n: 2, request: asked!.id, by: "CP" } });
    // Declining it afterwards changes nothing: it was answered.
    expect(await recordTask(code, { action: "decline", request: asked!.id }, "CP", at(150))).toEqual({ ok: true, entry: null, already: true });
    expect(await recordTask(code, { action: "done", asset: 1 }, "CP", at(160))).toMatchObject({ ok: true, entry: { action: "done" } });

    await endMission(code, at(170));
    expect(await recordTask(code, { action: "send", asset: 1, n: 2, request: null }, "CP", at(180))).toMatchObject({ ok: false, ended: true });
  });
});
