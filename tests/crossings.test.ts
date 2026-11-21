import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crossingsOf } from "../lib/geo/crossings";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { distanceM } from "../lib/geo/geo";
import { resolve } from "../lib/geo/resolver";
import type { GazetteerFeature, Intent, LastPosition, Resolution } from "../lib/geo/types";
import { foldLog, headingOf } from "../lib/reports/fold";
import { positionFromPlacement, positionFromReport } from "../lib/reports/position";
import { createMission, recordReport, reportContext, type ReportInput } from "../lib/reports/record";
import type { LogEntry, ReportEntry } from "../lib/reports/types";

const NOW = Date.parse("2026-11-20T16:00:00Z");
const LAT = 48.85;

function street(id: string, name: string, lines: [number, number][][]): GazetteerFeature {
  const pts = lines.flat();
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return {
    id,
    name,
    names: [name],
    category: "street",
    subtype: "residential",
    lat: lats[0],
    lon: lons[0],
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    osm_type: "way",
    osm_id: 1,
    lines,
  };
}

// Rue Main runs east-west. Rue A, B and C cross it, about 146 m apart; Rue C is a dual
// carriageway (two lines 11 m apart). Rue Haute passes over Rue Main on a bridge: no shared point.
// A second "Rue Main" carries on east from where the first one ends.
const ns = (lon: number): [number, number][] => [
  [lon, LAT - 0.002],
  [lon, LAT],
  [lon, LAT + 0.002],
];
const MAIN = street("street/rue-main", "Rue Main", [
  [
    [2.4, LAT],
    [2.402, LAT],
    [2.404, LAT],
    [2.406, LAT],
    [2.40615, LAT],
    [2.408, LAT],
    [2.41, LAT],
  ],
]);
const A = street("street/rue-a", "Rue A", [ns(2.402)]);
const B = street("street/rue-b", "Rue B", [ns(2.404)]);
const C = street("street/rue-c", "Rue C", [ns(2.406), ns(2.40615)]);
const HAUTE = street("street/rue-haute", "Rue Haute", [
  [
    [2.408, LAT - 0.002],
    [2.408, LAT + 0.002],
  ],
]);
const MAIN_2 = street("street/rue-main-2", "Rue Main", [
  [
    [2.41, LAT],
    [2.412, LAT],
  ],
]);
const LILAS = street("street/carrefour-des-lilas", "Carrefour des Lilas", [
  [
    [2.3, 48.9],
    [2.301, 48.9],
  ],
]);
const GRID = [MAIN, A, B, C, HAUTE, MAIN_2, LILAS];

function intent(p: Partial<Intent>): Intent {
  return {
    kind: "position",
    landmark_text: "the next intersection",
    landmark_name: null,
    landmark_category: "intersection",
    relation: "at",
    language: "en",
    confidence: 0.9,
    ...p,
  };
}
/** On Rue Main, between Rue A (80 m west) and Rue B (66 m east). */
const BETWEEN: LastPosition = { lat: LAT, lon: 2.4031, ts: NOW - 60_000, radius_m: 30, street: MAIN.id };
const run = (i: Partial<Intent>, last: LastPosition | null, transcript = "Passing the next intersection."): Resolution =>
  resolve({ intent: intent(i), transcript, lastPosition: last, now: NOW, gazetteer: GRID });

describe("crossings from street lines", () => {
  const all = crossingsOf(GRID);

  it("finds a crossing where named streets share a point, and one for a dual carriageway", () => {
    expect(all.map((c) => c.streets.join("+")).sort()).toEqual(["street/rue-a+street/rue-main", "street/rue-b+street/rue-main", "street/rue-c+street/rue-main"]);
  });

  it("finds none at a bridge, and none where a street of the same name carries on", () => {
    expect(all.some((c) => c.streets.includes(HAUTE.id))).toBe(false);
    expect(all.some((c) => c.streets.includes(MAIN_2.id))).toBe(false);
  });

  it("puts the dual carriageway's crossing between its two points", () => {
    const c = all.find((x) => x.streets.includes(C.id))!;
    expect(c.lon).toBeGreaterThan(2.406);
    expect(c.lon).toBeLessThan(2.40615);
  });

  it("finds the crossings on Avenue de Nogent in the Vincennes gazetteer", () => {
    const on = crossingsOf(loadGazetteer("vincennes")).filter((c) => c.streets.includes("street/avenue-de-nogent"));
    expect(on.length).toBeGreaterThanOrEqual(5);
  });
});

describe("the next crossing", () => {
  it("asks which way along the speaker's street when the way they are going is not known", () => {
    const r = run({}, BETWEEN);
    expect(r.status).toBe("ambiguous");
    expect(r.evidence.rule).toBe("crossing_next_ambiguous");
    expect(r.candidates.map((c) => c.name)).toEqual(["Rue Main / Rue B", "Rue Main / Rue A"]);
    expect(r.question).toBe("Which crossing on Rue Main: Rue B, or Rue A?");
  });

  it("asks in French and Ukrainian", () => {
    expect(run({ language: "fr" }, BETWEEN).question).toBe("Quel carrefour sur Rue Main : Rue B ou Rue A ?");
    expect(run({ language: "uk" }, BETWEEN).question).toBe("Яке перехрестя на Rue Main: Rue B чи Rue A?");
  });

  it("takes the one ahead when the unit was moving along its street", () => {
    const r = run({}, { ...BETWEEN, heading_deg: 90 });
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("crossing_next_ahead");
    expect(r.candidates[0].streets).toContain(B.id);
    expect(r.pin).toEqual({ lat: LAT, lon: 2.404 });
    expect(r.radius_m).toBe(30);
  });

  it("does not count a move across the street, or an old one", () => {
    expect(run({}, { ...BETWEEN, heading_deg: 0 }).status).toBe("ambiguous");
    expect(run({}, { ...BETWEEN, heading_deg: 90, ts: NOW - 30 * 60_000 }).status).toBe("ambiguous");
  });

  it("skips the crossing the unit is at", () => {
    const atA: LastPosition = { lat: LAT, lon: 2.402, ts: NOW - 60_000, radius_m: 30, street: MAIN.id, heading_deg: 90 };
    const r = run({}, atA);
    expect(r.status).toBe("resolved");
    expect(r.candidates[0].streets).toContain(B.id);
  });

  it("takes a compass direction said in the report, even with no street known", () => {
    const r = run({ direction: "west" }, { lat: LAT, lon: 2.4031, ts: NOW - 60_000 });
    expect(r.status).toBe("resolved");
    expect(r.candidates[0].streets).toContain(A.id);
  });

  it("with no street known, asks among the nearest in different directions", () => {
    const r = run({}, { lat: LAT + 0.0003, lon: 2.4031, ts: NOW - 60_000 });
    expect(r.status).toBe("ambiguous");
    expect(r.question).toBe("Which crossing: Rue B / Rue Main, or Rue A / Rue Main?");
  });

  it("does not hold the unit to a street it is still far from", () => {
    const r = run({}, { lat: LAT + 0.002, lon: 2.4031, ts: NOW - 60_000, street: MAIN.id });
    expect(r.evidence.detail).toContain("around the last position");
  });

  it("with no last position, asks for the streets", () => {
    const r = run({}, null);
    expect(r.status).toBe("unresolved");
    expect(r.evidence.rule).toBe("crossing_no_start");
    expect(r.question).toBe("I don't know where you are. Name the streets that cross there.");
  });

  it("is read from the words when the model found no place in them", () => {
    const r = run({ kind: "other", landmark_text: null, landmark_category: null, relation: null }, BETWEEN);
    expect(r.evidence.rule).toBe("crossing_next_ambiguous");
  });

  it("drops 'the next' when the model gave it as a name", () => {
    const r = run({ landmark_name: "the next intersection", landmark_name_lemma: "the next intersection" }, BETWEEN);
    expect(r.evidence.rule).toBe("crossing_next_ambiguous");
  });

  it("a tapped choice puts the unit at the crossing", () => {
    const c = run({}, BETWEEN).candidates[1];
    expect(positionFromPlacement(c.placement, c.name)).toEqual({ lat: LAT, lon: 2.402, radius_m: 30, label: "Rue Main / Rue A" });
  });
});

describe("a crossing with a street named", () => {
  it("is where that street crosses the speaker's street", () => {
    const r = run({ landmark_text: "the corner of Rue C", landmark_name: "Rue C", landmark_name_lemma: "Rue C" }, BETWEEN, "At the corner of Rue C");
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("crossing_unique");
    expect(r.candidates[0].name).toBe("Rue Main / Rue C");
  });

  it("keeps only the street when the crossing word came with the name", () => {
    const r = run({ landmark_name: "the corner of Rue C" }, BETWEEN, "At the corner of Rue C");
    expect(r.candidates[0]?.name).toBe("Rue Main / Rue C");
  });

  it("leaves a place named Carrefour to the name search", () => {
    const r = run({ landmark_name: "Carrefour des Lilas", landmark_name_lemma: "Carrefour des Lilas" }, null, "I'm at the Carrefour des Lilas");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(LILAS.id);
  });

  it("says when no street has that name", () => {
    expect(run({ landmark_name: "Rue Nulle", landmark_name_lemma: "Rue Nulle" }, BETWEEN).evidence.rule).toBe("crossing_street_none");
  });
});

describe("a crossing the model saw where none was said", () => {
  it("searches the name as usual: 'Я на Майдані Незалежності' is the square, not a crossing on it", () => {
    // Hosted Mistral returned landmark_category "intersection" for this sentence (Kyiv demo step k4).
    const r = resolve({
      intent: { kind: "position", landmark_text: "Майдані Незалежності", landmark_name: "Майдані Незалежності", landmark_name_lemma: "Майдан Незалежності", landmark_category: "intersection", relation: "at", distance_m: null, direction: null, language: "uk", confidence: 0.9 },
      transcript: "Я на Майдані Незалежності.",
      now: NOW,
      gazetteer: loadGazetteer("kyiv"),
      areaCentre: { lat: 50.45, lon: 30.52 },
    });
    expect(r.evidence.rule).toBe("named_unique");
    expect(r.evidence.feature_id).toBe("node/9151090552");
  });

  it("still takes a crossing said in French, Ukrainian or Russian", () => {
    for (const said of ["Au coin de la rue C", "На розі вулиці C", "На перекрестке с улицей C"]) {
      const r = run({ landmark_name: "Rue C", landmark_name_lemma: "Rue C" }, BETWEEN, said);
      expect(r.candidates[0]?.name, said).toBe("Rue Main / Rue C");
    }
  });
});

describe("the report that was not accepted", () => {
  // 20 November, mission vincennes-4: "Moving down Avenue de Nogent" from Château de Vincennes station, then this.
  const gaz = loadGazetteer("vincennes");
  const last: LastPosition = { lat: 48.84453, lon: 2.439195, ts: NOW - 44_000, radius_m: 50, uncertainty_m: 50, street: "street/avenue-de-nogent" };
  const said: Intent = { kind: "other", landmark_text: null, landmark_name: null, landmark_name_lemma: null, landmark_category: null, relation: null, distance_m: null, direction: null, language: "en", confidence: 0.95 };

  it("is now placed at the next crossing down Avenue de Nogent", () => {
    const r = resolve({ intent: said, transcript: "Passing the next intersection.", lastPosition: last, now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(r.candidates[0].streets).toContain("street/avenue-de-nogent");
    expect(r.candidates[0].name).toMatch(/^Avenue de Nogent \/ /);
    expect(distanceM(last, r.pin!)).toBeLessThan(150);
  });
});

describe("the street and the way a unit is going, kept in the log", () => {
  const T = (s: number) => NOW + s * 1000;
  const report = (id: string, ts: number, resolution: Resolution): ReportEntry => ({
    kind: "report",
    id,
    session: "test-1",
    callsign: "ALPHA 1",
    seq: null,
    ts,
    clientTs: null,
    area: "vincennes",
    transcript: "",
    language: "en",
    intent: null,
    resolution,
    lastPosition: null,
    position: positionFromReport(resolution, null),
    timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 },
  });
  const onMain: Resolution = {
    status: "resolved",
    pin: { lat: LAT, lon: 2.4005 },
    radius_m: 40,
    candidates: [{ id: MAIN.id, name: "Rue Main", category: "street", lat: LAT, lon: 2.4005, distance_m: 0, placement: { pin: { lat: LAT, lon: 2.4005 }, radius_m: 40 } }],
    evidence: { rule: "named_unique", feature_id: MAIN.id, detail: "" },
  };
  const next = run({}, { lat: LAT, lon: 2.4005, ts: T(0), street: MAIN.id, heading_deg: 90 });
  const church: Resolution = {
    status: "resolved",
    pin: { lat: LAT + 0.001, lon: 2.405 },
    radius_m: 30,
    candidates: [{ id: "church/x", name: "Église", category: "church", lat: LAT + 0.001, lon: 2.405, distance_m: 0, placement: { pin: { lat: LAT + 0.001, lon: 2.405 }, radius_m: 30 } }],
    evidence: { rule: "named_unique", feature_id: "church/x", detail: "" },
  };

  it("keeps the street through a crossing on it, with the way it moved", () => {
    const log: LogEntry[] = [report("r1", T(0), onMain), report("r2", T(60), next)];
    const u = foldLog(log).units[0];
    expect(u.street).toBe(MAIN.id);
    expect(headingOf(u)).toBe(90);
  });

  it("forgets the street at a place that is not on it", () => {
    const log: LogEntry[] = [report("r1", T(0), onMain), report("r2", T(60), church)];
    expect(foldLog(log).units[0].street).toBeNull();
  });
});

describe("walking down Avenue de Nogent, through the coordinator", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "crossings-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const gaz = loadGazetteer("vincennes");
  const T = (s: number) => NOW + s * 1000;
  const nothing: Intent = { kind: "other", landmark_text: null, landmark_name: null, landmark_name_lemma: null, landmark_category: null, relation: null, distance_m: null, direction: null, language: "en", confidence: 0.9 };

  /** Resolves a report the way the route does, from the mission's last position, and saves it. */
  async function say(session: string, transcript: string, intent: Intent, ts: number): Promise<Resolution> {
    const ctx = await reportContext(session, "ALPHA 1", { area: "vincennes", lastPosition: null }, ts);
    if (!ctx.ok) throw new Error(ctx.error);
    const resolution = resolve({ intent, transcript, lastPosition: ctx.lastPosition, now: ts, gazetteer: gaz });
    const input: ReportInput = { session, callsign: "ALPHA 1", seq: null, clientTs: null, area: "vincennes", transcript, language: "en", intent, resolution, lastPosition: ctx.lastPosition, timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 } };
    await recordReport(input, ts);
    return resolution;
  }

  it("places each next crossing in turn, and asks nothing once the way is known", async () => {
    const m = await createMission({ area: "vincennes", name: "Walk", start: null }, T(0));
    if (!m.ok) throw new Error(m.error);
    const code = m.mission.code;

    const station = await say(code, "I'm at the Château de Vincennes metro station", { ...nothing, kind: "position", landmark_text: "the Château de Vincennes metro station", landmark_name: "Château de Vincennes", landmark_name_lemma: "Château de Vincennes", landmark_category: "metro_station", relation: "at" }, T(10));
    expect(station.status).toBe("resolved");
    const down = await say(code, "Moving down Avenue de Nogent", { ...nothing, kind: "movement", landmark_text: "Avenue de Nogent", landmark_name: "Avenue de Nogent", landmark_name_lemma: "Avenue de Nogent", landmark_category: "street" }, T(30));
    expect(down.evidence.feature_id).toBe("street/avenue-de-nogent");

    const first = await say(code, "Passing the next intersection.", nothing, T(70));
    expect(first.status).toBe("resolved");
    expect(first.candidates[0].name).toBe("Avenue de Nogent / Villa d'Idalie");

    const ctx = await reportContext(code, "ALPHA 1", { area: "vincennes", lastPosition: null }, T(100));
    expect(ctx.ok && ctx.lastPosition?.street).toBe("street/avenue-de-nogent");

    const second = await say(code, "Passing the next intersection.", nothing, T(120));
    expect(second.status).toBe("resolved");
    expect(second.evidence.rule).toBe("crossing_next_ahead");
    expect(second.candidates[0].streets).toContain("street/avenue-de-nogent");
    expect(second.candidates[0].id).not.toBe(first.candidates[0].id);
    // Further down the avenue, away from the station.
    expect(second.pin!.lon).toBeGreaterThan(first.pin!.lon);
  });
});
