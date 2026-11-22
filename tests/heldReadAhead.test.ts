import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Intent } from "../lib/geo/types";
import { forgetHeldReadings, heldReadings, heldWords, readHeldAhead, readOnce, type Readings } from "../lib/reports/pipeline";
import { createMission, saveHeld, type HeldInput } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import type { HeldEntry, ReportEntry, StartPoint } from "../lib/reports/types";

// A held radio report is read by the model while it waits, and only placed when given [256].

/** "Moved 200 metres north": where it puts a unit depends on where that unit was. */
const NORTH: Intent = { kind: "movement", landmark_text: null, landmark_name: null, landmark_category: null, relation: null, distance_m: 200, direction: "north", language: "en", confidence: 0.9 };

/** The model, counted, and held back until a test lets it answer. */
const model = vi.hoisted(() => ({
  calls: [] as string[],
  fail: 0,
  gate: null as Promise<void> | null,
}));

vi.mock("../lib/providers/extractor", async (original) => ({
  ...(await original<typeof import("../lib/providers/extractor")>()),
  getExtractor: () => ({
    name: "fake",
    extract: async (text: string) => {
      model.calls.push(text);
      if (model.gate) await model.gate;
      if (model.fail > 0) {
        model.fail--;
        throw new Error("the model is down");
      }
      return NORTH;
    },
  }),
}));

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
const at = (s: number) => T0 + s * 1000;
const S = "vincennes-1";
const START: StartPoint = { id: "castle/chateau", name: "Château de Vincennes", category: "castle", lat: 48.8427, lon: 2.4358, radius_m: 300 };

function held(extra: Partial<HeldInput> = {}): HeldInput {
  return {
    session: S,
    clientTs: null,
    area: "vincennes",
    transcript: "Alpha, moved 200 metres north, over",
    language: "en",
    reason: "which",
    heard: "Alpha",
    read: null,
    candidates: ["ALPHA 1", "ALPHA 2"],
    question: "Heard “Alpha”. Which unit sent this: ALPHA 1 or ALPHA 2?",
    audio: null,
    ...extra,
  };
}

/** The operator gives held report `id` to `callsign`, through the route the command post calls. */
async function give(id: string, callsign: string) {
  const { POST } = await import("../app/api/sessions/[code]/held/[id]/route");
  const req = new Request(`http://localhost/api/sessions/${S}/held/${id}`, { method: "POST", body: JSON.stringify({ action: "assign", callsign }) });
  const res = await POST(req, { params: Promise.resolve({ code: S, id }) } as Parameters<typeof POST>[1]);
  return { status: res.status, body: await res.json() };
}

async function reportFor(held: string): Promise<ReportEntry | undefined> {
  const { entries } = await getStore().list(S);
  return entries.find((e): e is ReportEntry => e.kind === "report" && e.sender?.held === held);
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "held-ahead-"));
  process.env.REPORT_STORE = "file";
  process.env.REPORT_STORE_DIR = dir;
  expect(await createMission({ area: "vincennes", name: "Radio net", start: START, roster: ["ALPHA 1", "ALPHA 2"] }, at(0))).toMatchObject({ ok: true });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  model.calls = [];
  model.fail = 0;
  model.gate = null;
});

describe("a held radio report, read while it waits", () => {
  it("is read by the model once: giving it to a unit only places it", async () => {
    const h = (await saveHeld(held(), at(10))) as HeldEntry;
    await readHeldAhead(h);
    expect(model.calls).toEqual(["moved 200 metres north"]);
    const r = await give(h.id, "ALPHA 1");
    expect(r).toMatchObject({ status: 200, body: { callsign: "ALPHA 1", already: false } });
    expect(model.calls).toHaveLength(1);
    // Placed from where ALPHA 1 was, with what the model read before.
    expect(await reportFor(h.id)).toMatchObject({ callsign: "ALPHA 1", intent: NORTH, resolution: { status: "resolved" }, sender: { how: "operator" } });
    // Settled: its reading is not kept.
    expect(heldReadings(S, h.id)).toBeUndefined();
  });

  it("given while the model is still reading, waits for that reading instead of starting another", async () => {
    let answer!: () => void;
    model.gate = new Promise((go) => (answer = go));
    const h = (await saveHeld(held(), at(20))) as HeldEntry;
    const ahead = readHeldAhead(h);
    const given = give(h.id, "ALPHA 2");
    await new Promise((later) => setTimeout(later, 20));
    answer();
    await ahead;
    expect((await given).status).toBe(200);
    expect(model.calls).toHaveLength(1);
    expect(await reportFor(h.id)).toMatchObject({ callsign: "ALPHA 2", intent: NORTH });
  });

  it("is read again when given if the reading ahead failed", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    model.fail = 1;
    const h = (await saveHeld(held(), at(30))) as HeldEntry;
    await readHeldAhead(h);
    expect(model.calls).toHaveLength(1);
    expect((await give(h.id, "ALPHA 1")).status).toBe(200);
    expect(model.calls).toHaveLength(2);
    expect(await reportFor(h.id)).toMatchObject({ intent: NORTH });
    quiet.mockRestore();
  });

  it("held after it was read (`far`), is not read again", async () => {
    const readings: Readings = new Map([["moved 200 metres north", Promise.resolve(NORTH)]]);
    const h = (await saveHeld(held({ reason: "far", heard: "Alpha", candidates: ["ALPHA 2", "ALPHA 1"] }), at(40))) as HeldEntry;
    await readHeldAhead(h, readings);
    expect((await give(h.id, "ALPHA 2")).status).toBe(200);
    expect(model.calls).toHaveLength(0);
  });

  it("is read when given if the coordinator has no reading of it (restarted)", async () => {
    const h = (await saveHeld(held(), at(50))) as HeldEntry;
    await readHeldAhead(h);
    forgetHeldReadings(S, h.id);
    expect((await give(h.id, "ALPHA 1")).status).toBe(200);
    expect(model.calls).toHaveLength(2);
  });

  it("with nothing to read (no words, or only a request), keeps no reading", async () => {
    const empty = (await saveHeld(held({ transcript: "", heard: null, reason: "none" }), at(60))) as HeldEntry;
    await readHeldAhead(empty);
    expect(heldReadings(S, empty.id)).toBeUndefined();
    expect(heldWords({ transcript: "Alpha, send the drone to track 3, over", heard: "Alpha" }).text).toBeNull();
    expect(model.calls).toHaveLength(0);
  });
});

describe("readOnce", () => {
  it("sends each text to the model once, even when asked twice at the same time", async () => {
    const extract = vi.fn(async (text: string) => ({ ...NORTH, landmark_text: text }));
    const read = readOnce(new Map(), extract);
    const [a, b, c] = await Promise.all([read("one"), read("one"), read("two")]);
    expect(a).toEqual(b);
    expect(c.landmark_text).toBe("two");
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("reads again a text whose reading failed", async () => {
    const extract = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(NORTH);
    const readings: Readings = new Map();
    const read = readOnce(readings, extract);
    await expect(read("one")).rejects.toThrow("down");
    await expect(read("one")).resolves.toEqual(NORTH);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(readings.size).toBe(1);
  });
});
