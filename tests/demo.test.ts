import { describe, expect, it } from "vitest";
import { demoEntries, demoLog } from "../lib/reports/demo";
import { foldLog } from "../lib/reports/fold";
import { DEMO_SESSION } from "../lib/reports/types";

describe("the recorded demo mission", () => {
  it("is a whole, fresh mission and folds like a live log", () => {
    const now = 1_800_000_000_000;
    const { total, entries } = demoLog(0, now);
    expect(total).toBeGreaterThan(15);
    expect(entries.every((e) => e.session === DEMO_SESSION)).toBe(true);
    expect(entries.map((e) => e.ts)).toEqual([...entries.map((e) => e.ts)].sort((a, b) => a - b));
    // The last line is 20 s old, so the public page opens on a live-looking patrol.
    expect(now - entries[entries.length - 1].ts).toBe(20_000);

    const state = foldLog(entries);
    expect(state.mission?.name).toBe("Vincennes · demo");
    expect(state.units.map((u) => u.callsign)).toEqual(["ALPHA 1", "BRAVO 2", "CHARLIE 3", "DRONE 1"]);
    expect(state.tracks.map((t) => t.n)).toEqual([1, 2, 3]);
    // The question is closed by the answer, and the request by the task.
    expect(state.units.filter((u) => u.pending || u.prompt)).toEqual([]);
    expect(state.requests).toEqual([]);
    // The drone was sent to look at Track 1.
    expect(state.units.find((u) => u.callsign === "DRONE 1")?.task?.n).toBe(1);
    // The spoken reply and the command post's answer moved CHARLIE 3 to the church it meant,
    // and the operator's later place is the one on the map, marked CP.
    expect(state.units.find((u) => u.callsign === "CHARLIE 3")?.position?.label).toBe("Église Notre-Dame");
    expect(state.units.find((u) => u.callsign === "CHARLIE 3")?.placedBy).toBe("CP");
    // Every report in the demo has words, a rule and timings.
    for (const e of entries.filter((x) => x.kind === "report")) {
      expect(e.transcript.length).toBeGreaterThan(0);
      expect(e.resolution.evidence.rule.length).toBeGreaterThan(0);
      expect(e.timings_ms.total).toBeGreaterThan(0);
    }
  });

  it("slices after a count, as the poller asks", () => {
    const now = 1_800_000_000_000;
    const all = demoLog(0, now);
    const tail = demoLog(5, now);
    expect(tail.total).toBe(all.total);
    expect(tail.entries).toEqual(all.entries.slice(5));
    expect(demoLog(all.total, now).entries).toEqual([]);
  });

  it("keeps its recorded offsets, so a test never depends on the clock", () => {
    const offsets = demoEntries().map((e) => e.ts);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets.every((t) => t <= 0)).toBe(true);
  });
});
