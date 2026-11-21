import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { destination } from "../lib/geo/geo";
import { loadGazetteer } from "../lib/geo/gazetteer";
import type { Resolution } from "../lib/geo/types";
import { foldLog } from "../lib/reports/fold";
import { nextTrackNumber, parsePlot, plotPosition, pointLabel } from "../lib/reports/plot";
import { createMission, endMission, recordAnswer, recordPlot, reportContext, saveReport } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import type { LogEntry, PlotEntry, ReportEntry } from "../lib/reports/types";

const T0 = Date.UTC(2026, 10, 21, 14, 0, 0);
const at = (s: number) => T0 + s * 1000;
const VINCENNES = loadGazetteer("vincennes");
const CHATEAU = { lat: 48.84276, lon: 2.43589 };
const MAIRIE = { lat: 48.84765, lon: 2.43977 };

function plot(id: string, s: number, e: Partial<PlotEntry> & Pick<PlotEntry, "action" | "n">): PlotEntry {
  return { kind: "plot", id, session: "vincennes-1", ts: at(s), by: "CP", ...e };
}

const MISSION: LogEntry = { kind: "mission", id: "m", session: "vincennes-1", ts: at(0), area: "vincennes", name: "Walk", start: null };

describe("checking what the command post sent", () => {
  it("a new track needs whose it is and what it is, and a point or a place", () => {
    expect(parsePlot({ affiliation: "hostile", kind: "armour", count: 2, lat: 48.84, lon: 2.43, radius_m: 100 }, "place", null)).toEqual({
      ok: true,
      input: { action: "place", affiliation: "hostile", track_kind: "armour", count: 2, where: { lat: 48.84, lon: 2.43 }, radius_m: 100, note: null },
    });
    expect(parsePlot({ kind: "armour", lat: 48.84, lon: 2.43 }, "place", null)).toMatchObject({ ok: false, error: expect.stringContaining("affiliation") });
    expect(parsePlot({ affiliation: "hostile", kind: "tank", lat: 48.84, lon: 2.43 }, "place", null)).toMatchObject({ ok: false, error: expect.stringContaining("kind") });
    expect(parsePlot({ affiliation: "unknown", kind: "vehicle" }, "place", null)).toMatchObject({ ok: false, error: expect.stringContaining("lat") });
  });

  it("a count of one is no count, and a note is tidied", () => {
    const r = parsePlot({ affiliation: "friendly", kind: "drone_team", count: 1, place: "way/23032971", note: "  drone   feed " }, "place", null);
    expect(r).toMatchObject({ ok: true, input: { count: null, where: { place: "way/23032971" }, radius_m: 50, note: "drone feed" } });
    expect(parsePlot({ affiliation: "unknown", kind: "vehicle", lat: 48.84, lon: 2.43, count: 2.5 }, "place", null)).toMatchObject({ ok: false });
    expect(parsePlot({ affiliation: "unknown", kind: "vehicle", lat: 48.84, lon: 2.43, radius_m: 1 }, "place", null)).toMatchObject({ ok: false });
  });

  it("a change names a track; gone and back need nothing else", () => {
    expect(parsePlot({ affiliation: "hostile", kind: "vehicle" }, "edit", 3)).toMatchObject({ ok: true, input: { action: "edit", n: 3, affiliation: "hostile" } });
    expect(parsePlot({}, "gone", 3)).toEqual({ ok: true, input: { action: "gone", n: 3 } });
    expect(parsePlot({}, "gone", null)).toMatchObject({ ok: false });
    expect(parsePlot({ lat: 48.84, lon: 2.43 }, "move", 3)).toMatchObject({ ok: true, input: { action: "move", n: 3, radius_m: 50 } });
  });
});

describe("where a placed track goes, and its name", () => {
  it("a click on a place is named by the place", () => {
    expect(pointLabel(CHATEAU, VINCENNES)).toBe("Château de Vincennes");
  });

  it("a click off a place is a distance and a direction from the nearest landmark, before a street", () => {
    const church = { lat: 48.84, lon: 2.43 };
    const south = destination(church, 180, 60);
    const features = [
      { id: "c", name: "Église", names: [], category: "church" as const, lat: church.lat, lon: church.lon, osm_type: "node" as const, osm_id: 1 },
      { id: "s", name: "Rue Basse", names: [], category: "street" as const, lat: south.lat, lon: south.lon, osm_type: "way" as const, osm_id: 2, lines: [[[2.42, south.lat], [2.44, south.lat]]] as [number, number][][] },
    ];
    // 120 m east of the church: the street is nearer, but the church is the better name.
    expect(pointLabel(destination(church, 90, 120), features)).toBe("120 m east of Église");
    // On the street itself: the street.
    expect(pointLabel(destination(south, 90, 150), features)).toBe("Rue Basse");
    // Far from any landmark: the street, with a distance.
    expect(pointLabel(destination(destination(south, 90, 500), 180, 80), features)).toBe("80 m south of Rue Basse");
  });

  it("a picked place keeps at least its own size; a click keeps the circle chosen", () => {
    const picked = plotPosition({ place: "way/23032971" }, 50, "vincennes", VINCENNES);
    expect(picked).toMatchObject({ label: "Château de Vincennes", lat: 48.84276, lon: 2.43589 });
    expect((picked as { radius_m: number }).radius_m).toBeGreaterThan(50);
    expect(plotPosition(CHATEAU, 100, "vincennes", VINCENNES)).toMatchObject({ radius_m: 100, label: "Château de Vincennes" });
  });

  it("refuses a point outside the mission's area, and a place that is not in it", () => {
    expect(plotPosition({ lat: 50.45, lon: 30.52 }, 50, "vincennes", VINCENNES)).toMatch(/outside Vincennes/);
    expect(plotPosition({ place: "node/1" }, 50, "vincennes", VINCENNES)).toMatch(/No place/);
  });
});

describe("tracks placed at the command post, in the log", () => {
  const pos = { lat: CHATEAU.lat, lon: CHATEAU.lon, radius_m: 50, label: "Château de Vincennes" };
  const moved = { lat: MAIRIE.lat, lon: MAIRIE.lon, radius_m: 100, label: "Mairie de Vincennes" };

  it("numbers count on from reported tracks and placed ones alike", () => {
    const reported = { kind: "report", track: { n: 4 } } as unknown as ReportEntry;
    expect(nextTrackNumber([MISSION])).toBe(1);
    expect(nextTrackNumber([MISSION, reported])).toBe(5);
    expect(nextTrackNumber([MISSION, reported, plot("p", 1, { action: "place", n: 7 })])).toBe(8);
  });

  it("a placed track is on the map, by the CP, with no line of sight", () => {
    const s = foldLog([MISSION, plot("p1", 10, { action: "place", n: 1, affiliation: "hostile", track_kind: "armour", count: 2, position: pos, note: "drone feed" })]);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0]).toMatchObject({ n: 1, affiliation: "hostile", kind: "armour", count: 2, seenBy: "CP", openedBy: "CP", from: null, plotted: true, note: "drone feed", gone: null, area: "vincennes" });
    expect(s.feed[0]).toMatchObject({ kind: "plot", callsign: "CP", track: 1, outcome: "Placed Track 1: hostile armour ×2, Château de Vincennes (±50 m). Source: drone feed." });
    // The command post is not a unit.
    expect(s.units).toHaveLength(0);
  });

  it("a change keeps the place; a move leaves a trail; gone takes it off and back brings it back", () => {
    const log: LogEntry[] = [
      MISSION,
      plot("p1", 10, { action: "place", n: 1, affiliation: "unknown", track_kind: "vehicle", count: null, position: pos }),
      plot("p2", 20, { action: "edit", n: 1, affiliation: "hostile", track_kind: "vehicle", count: 3 }),
      plot("p3", 30, { action: "move", n: 1, position: moved }),
      plot("p4", 40, { action: "gone", n: 1 }),
    ];
    const changed = foldLog(log, at(20)).tracks[0];
    expect(changed).toMatchObject({ affiliation: "hostile", count: 3, changed: { by: "CP", ts: at(20) }, position: pos });
    const after = foldLog(log, at(30)).tracks[0];
    expect(after.position).toEqual(moved);
    expect(after.trail).toEqual([{ lat: pos.lat, lon: pos.lon, ts: at(10) }]);
    expect(foldLog(log).tracks[0].gone).toBe(at(40));
    expect(foldLog([...log, plot("p5", 50, { action: "restore", n: 1 })]).tracks[0].gone).toBeNull();
  });

  it("a unit's report about a gone track brings it back, as its sighting", () => {
    const sighting: ReportEntry = {
      kind: "report",
      id: "r1",
      session: "vincennes-1",
      callsign: "ALPHA 1",
      seq: null,
      ts: at(60),
      clientTs: null,
      area: "vincennes",
      transcript: "Track 1 moved to the mairie",
      language: "en",
      intent: null,
      resolution: { status: "resolved", candidates: [], evidence: { rule: "exact", detail: "" } },
      lastPosition: null,
      position: null,
      track: { n: 1, affiliation: null, kind: null, count: null, text: null, heading: null, position: moved, from: { lat: 48.845, lon: 2.429 } },
      timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 },
    };
    const t = foldLog([MISSION, plot("p1", 10, { action: "place", n: 1, affiliation: "hostile", track_kind: "vehicle", count: null, position: pos }), plot("p2", 20, { action: "gone", n: 1 }), sighting]).tracks[0];
    expect(t).toMatchObject({ gone: null, seenBy: "ALPHA 1", plotted: false, affiliation: "hostile", from: { lat: 48.845, lon: 2.429 } });
  });

  it("a plot about a track the log does not have changes nothing", () => {
    expect(foldLog([MISSION, plot("p1", 10, { action: "move", n: 9, position: moved })]).tracks).toHaveLength(0);
  });
});

describe("the command post on the coordinator", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "plots-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("places, changes, moves and removes tracks; a unit can then name the number", async () => {
    const m = await createMission({ area: "vincennes", name: "CP", start: null }, at(0));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const placed = await recordPlot(code, { action: "place", affiliation: "friendly", track_kind: "mortar", count: null, where: { place: "way/83816816" }, radius_m: 25, note: null }, "CP", at(10));
    expect(placed).toMatchObject({ ok: true, entry: { action: "place", n: 1, position: { label: "Mairie de Vincennes" } } });
    const second = await recordPlot(code, { action: "place", affiliation: "hostile", track_kind: "vehicle", count: 2, where: CHATEAU, radius_m: 100, note: "BRAVO 2 by phone" }, "CP", at(20));
    expect(second).toMatchObject({ ok: true, entry: { n: 2, position: { label: "Château de Vincennes", radius_m: 100 } } });
    expect(await recordPlot(code, { action: "gone", n: 9 }, "CP", at(30))).toMatchObject({ ok: false, status: 404 });
    expect(await recordPlot(code, { action: "move", n: 2, where: { lat: 50.45, lon: 30.52 }, radius_m: 50, note: null }, "CP", at(30))).toMatchObject({ ok: false, status: 400 });
    expect(await recordPlot(code, { action: "gone", n: 1 }, "CP", at(40))).toMatchObject({ ok: true });

    // Track numbers a unit can say include the ones placed here.
    const ctx = await reportContext(code, "ALPHA 1", { area: "vincennes", lastPosition: null }, at(50));
    expect(ctx).toMatchObject({ ok: true, tracks: [{ n: 1 }, { n: 2 }] });

    // A track a unit reports next gets the next number after them.
    const res: Resolution = {
      status: "resolved",
      candidates: [],
      evidence: { rule: "exact", detail: "" },
      track: { n: null, opened: true, affiliation: null, kind: "drone", count: null, text: "drone", heading: null, placement: { pin: MAIRIE, radius_m: 80 }, label: "Mairie de Vincennes", say: "" },
    } as Resolution;
    const saved = await saveReport({ session: code, callsign: "ALPHA 1", seq: null, clientTs: null, area: "vincennes", transcript: "drone at the mairie", language: "en", intent: null, resolution: res, lastPosition: null, timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 } }, at(60));
    expect(saved?.resolution.track?.n).toBe(3);

    await endMission(code, at(70));
    expect(await recordPlot(code, { action: "restore", n: 1 }, "CP", at(80))).toMatchObject({ ok: false, ended: true });
  });

  it("the command post can answer a unit's question; the first answer stands", async () => {
    const m = await createMission({ area: "vincennes", name: "Answers", start: null }, at(100));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;
    const a = { id: "castle/a", name: "A", category: "castle" as const, lat: CHATEAU.lat, lon: CHATEAU.lon, distance_m: 10, placement: { pin: CHATEAU, radius_m: 30 } };
    const b = { id: "town_hall/b", name: "B", category: "town_hall" as const, lat: MAIRIE.lat, lon: MAIRIE.lon, distance_m: 10, placement: { pin: MAIRIE, radius_m: 30 } };
    const ask: Resolution = { status: "ambiguous", candidates: [a, b], question: "A or B?", evidence: { rule: "ask", detail: "" } };
    const saved = await saveReport({ session: code, callsign: "BRAVO 2", seq: null, clientTs: null, area: "vincennes", transcript: "I'm at the one", language: "en", intent: null, resolution: ask, lastPosition: null, timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 } }, at(110));
    const byCp = await recordAnswer(code, saved!.id, "town_hall/b", at(120), "CP");
    expect(byCp).toMatchObject({ ok: true, entry: { by: "CP", callsign: "BRAVO 2", choice: "town_hall/b" } });
    // The phone answering late gets the command post's answer back.
    expect(await recordAnswer(code, saved!.id, "castle/a", at(130))).toMatchObject({ ok: true, entry: { by: "CP", choice: "town_hall/b" } });
    const s = foldLog((await getStore().list(code)).entries);
    const u = s.units.find((x) => x.callsign === "BRAVO 2")!;
    expect(u.position).toMatchObject({ label: "B" });
    // The command post choosing is not the unit being heard.
    expect(u.lastHeard).toBe(at(110));
    expect(s.feed.find((f) => f.id === saved!.id)).toMatchObject({ answer: { by: "CP", name: "B" }, outcome: expect.stringMatching(/^CP chose B\./) });
  });
});
