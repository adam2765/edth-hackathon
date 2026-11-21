import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Candidate, Intent, Resolution } from "../lib/geo/types";
import { colourMap, foldLog, UNIT_COLOURS } from "../lib/reports/fold";
import { labelFor, positionFromPlacement, positionFromReport } from "../lib/reports/position";
import { FileStore } from "../lib/reports/store";
import { callsignOf, sessionCode, type AnswerEntry, type LogEntry, type ReportEntry } from "../lib/reports/types";

const T0 = Date.UTC(2026, 10, 20, 18, 0, 0);

function cand(id: string, name: string, lat: number, lon: number, radius_m = 30): Candidate {
  return { id, name, category: "metro_station", lat, lon, distance_m: 100, placement: { pin: { lat, lon }, radius_m } };
}

const BERAULT = cand("station/berault", "Bérault", 48.8456, 2.4285);
const CHATEAU = cand("castle/chateau", "Château de Vincennes", 48.8427, 2.4358);
const MAIRIE = cand("town_hall/vincennes", "Mairie de Vincennes", 48.8476, 2.4392);

function resolved(c: Candidate, extra: Partial<Resolution> = {}): Resolution {
  return { status: "resolved", pin: c.placement.pin, radius_m: c.placement.radius_m, candidates: [c], evidence: { rule: "exact", feature_id: c.id, detail: "" }, ...extra };
}

function report(id: string, callsign: string, s: number, res: Resolution, extra: Partial<ReportEntry> = {}): ReportEntry {
  return {
    kind: "report",
    id,
    session: "demo",
    callsign,
    seq: null,
    ts: T0 + s * 1000,
    clientTs: null,
    area: "vincennes",
    transcript: id,
    language: "en",
    intent: null,
    resolution: res,
    lastPosition: null,
    position: positionFromReport(res, null),
    timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 },
    ...extra,
  };
}

function answer(id: string, callsign: string, s: number, reportId: string, choice: Candidate | null): AnswerEntry {
  return { kind: "answer", id, session: "demo", callsign, ts: T0 + s * 1000, report_id: reportId, choice: choice?.id ?? null, position: choice ? positionFromPlacement(choice.placement, choice.name) : null };
}

const ASK: Resolution = { status: "ambiguous", candidates: [CHATEAU, MAIRIE], question: "Château or mairie?", evidence: { rule: "ask", detail: "" } };

describe("where a report leaves the speaker", () => {
  it("a resolved place is a fix at that place", () => {
    expect(positionFromReport(resolved(BERAULT), null)).toEqual({ lat: 48.8456, lon: 2.4285, radius_m: 30, label: "Bérault" });
  });

  it("a movement is an estimate heading somewhere; with no start it does not move the speaker", () => {
    const heading_to = { id: CHATEAU.id, name: CHATEAU.name, lat: CHATEAU.lat, lon: CHATEAU.lon };
    const moved = positionFromPlacement({ pin: { lat: 48.844, lon: 2.432 }, radius_m: 200, heading_to }, CHATEAU.name);
    expect(moved).toMatchObject({ label: "towards Château de Vincennes", estimated: true, heading_to, radius_m: 200 });
    expect(positionFromPlacement({ heading_to }, CHATEAU.name)).toBeNull();
  });

  it("a question or an unplaced report does not move the speaker", () => {
    expect(positionFromReport(ASK, null)).toBeNull();
    expect(positionFromReport({ status: "unresolved", candidates: [], evidence: { rule: "none", detail: "" } }, null)).toBeNull();
  });

  it("dead reckoning is labelled by what it was worked out from", () => {
    const intent = { distance_m: 300, direction: "north_east" } as Intent;
    const res: Resolution = { status: "resolved", pin: { lat: 48.85, lon: 2.43 }, radius_m: 150, estimated: true, candidates: [], evidence: { rule: "dead_reckoning", detail: "" } };
    expect(labelFor(res, intent)).toBe("300 m north-east of the last position");
    expect(positionFromReport(res, intent)).toMatchObject({ estimated: true, radius_m: 150 });
  });
});

describe("rebuilding the map from the log", () => {
  const log: LogEntry[] = [
    report("r1", "ALPHA 1", 0, resolved(BERAULT)),
    report("r2", "BRAVO 2", 5, resolved(MAIRIE)),
    report("r3", "ALPHA 1", 10, ASK),
    answer("a3", "ALPHA 1", 14, "r3", CHATEAU),
  ];

  it("gives each call sign its own colour in the order they first report", () => {
    expect([...colourMap(log).entries()]).toEqual([
      ["ALPHA 1", UNIT_COLOURS[0]],
      ["BRAVO 2", UNIT_COLOURS[1]],
    ]);
  });

  it("an open question waits; the answer moves the marker and leaves a trail", () => {
    const asking = foldLog(log, T0 + 12_000);
    const a1 = asking.units.find((u) => u.callsign === "ALPHA 1")!;
    expect(a1.position?.label).toBe("Bérault");
    expect(a1.pending?.candidates.map((c) => c.id)).toEqual([CHATEAU.id, MAIRIE.id]);
    expect(asking.feed[0]).toMatchObject({ id: "r3", status: "ambiguous", answer: null });

    const answered = foldLog(log);
    const a1b = answered.units.find((u) => u.callsign === "ALPHA 1")!;
    expect(a1b.pending).toBeNull();
    expect(a1b.position?.label).toBe("Château de Vincennes");
    expect(a1b.trail).toEqual([{ lat: BERAULT.lat, lon: BERAULT.lon, ts: T0 }]);
    expect(answered.feed[0].outcome).toMatch(/^Chose Château de Vincennes/);
  });

  it("a replay is the log read up to a moment", () => {
    const early = foldLog(log, T0 + 4_000);
    expect(early.units.map((u) => u.callsign)).toEqual(["ALPHA 1"]);
    expect(early.feed).toHaveLength(1);
    expect(early.last).toBe(T0);
    // Colours stay the same as in the full log.
    expect(foldLog(log, T0 + 6_000).units[1].colour).toBe(UNIT_COLOURS[1]);
  });

  it("a late answer does not undo a newer fix", () => {
    const late: LogEntry[] = [report("r1", "ALPHA 1", 0, ASK), report("r2", "ALPHA 1", 5, resolved(BERAULT)), answer("a1", "ALPHA 1", 9, "r1", CHATEAU)];
    const u = foldLog(late).units[0];
    expect(u.position?.label).toBe("Bérault");
    expect(u.pending).toBeNull();
  });

  it("'none of these' closes the question without moving the marker", () => {
    const none: LogEntry[] = [report("r1", "ALPHA 1", 0, resolved(BERAULT)), report("r2", "ALPHA 1", 5, ASK), answer("a2", "ALPHA 1", 8, "r2", null)];
    const s = foldLog(none);
    expect(s.units[0].pending).toBeNull();
    expect(s.units[0].position?.label).toBe("Bérault");
    expect(s.feed[0].outcome).toBe("None of the choices was right.");
  });

  it("a movement keeps where it is heading, and the trail runs on to the new marker", () => {
    const heading_to = { id: CHATEAU.id, name: CHATEAU.name, lat: CHATEAU.lat, lon: CHATEAU.lon };
    const move = report("r2", "ALPHA 1", 5, resolved(CHATEAU, { pin: { lat: 48.844, lon: 2.432 }, radius_m: 200, heading_to, estimated: true }));
    const u = foldLog([report("r1", "ALPHA 1", 0, resolved(BERAULT)), move]).units[0];
    // The command post draws the dashed trail from the last fix to the marker, and the arrow on from the marker.
    expect(u.trail.at(-1)).toMatchObject({ lat: BERAULT.lat, lon: BERAULT.lon });
    expect(u.position).toMatchObject({ lat: 48.844, lon: 2.432 });
    expect(u.position?.heading_to?.id).toBe(CHATEAU.id);
  });
});

describe("the file store", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("appends, lists after a count, and reads only whole lines", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "v2m-store-"));
    const store = new FileStore(dir);
    expect(await store.list("demo")).toEqual({ total: 0, entries: [] });

    await store.append(report("r1", "ALPHA 1", 0, resolved(BERAULT)));
    await store.append(report("r2", "ALPHA 1", 5, resolved(MAIRIE)));
    expect((await store.list("demo")).total).toBe(2);
    expect((await store.list("demo", 1)).entries.map((e) => e.id)).toEqual(["r2"]);

    // A damaged line is skipped; a line still being written waits until it is whole.
    const file = path.join(dir, "demo.jsonl");
    await appendFile(file, "{not json\n");
    const half = JSON.stringify(report("r3", "ALPHA 1", 9, resolved(CHATEAU)));
    await appendFile(file, half.slice(0, 40));
    expect((await store.list("demo")).entries.map((e) => e.id)).toEqual(["r1", "r2"]);
    await appendFile(file, `${half.slice(40)}\n`);
    expect((await store.list("demo")).entries.map((e) => e.id)).toEqual(["r1", "r2", "r3"]);

    // A cleared file starts over.
    await writeFile(file, "");
    expect((await store.list("demo")).total).toBe(0);
  });

  it("refuses a session code that could leave its folder", async () => {
    const store = new FileStore(dir || tmpdir());
    await expect(store.list("../etc")).rejects.toThrow();
  });
});

describe("session codes and call signs", () => {
  it("keeps codes short and safe for a file name", () => {
    expect(sessionCode(" Demo ")).toBe("demo");
    expect(sessionCode("night-walk_2")).toBe("night-walk_2");
    expect(sessionCode("../x")).toBeNull();
    expect(sessionCode("")).toBeNull();
    expect(sessionCode("a".repeat(41))).toBeNull();
  });

  it("tidies call signs", () => {
    expect(callsignOf("  ALPHA   1 ")).toBe("ALPHA 1");
    expect(callsignOf("alpha 1")).toBe("ALPHA 1");
    expect(callsignOf("")).toBe("UNKNOWN");
    expect(callsignOf(undefined)).toBe("UNKNOWN");
  });
});
