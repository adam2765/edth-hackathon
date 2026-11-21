import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AREAS } from "../lib/geo/areas";
import { TRACK_KINDS } from "../lib/geo/trackKinds";
import { INTENT_SCHEMA, sanitizeIntent } from "../lib/providers/extractor";
import { compare, fieldMatches, inPrompt, normText, promptId, SCORED_FIELDS, scoreCase, scoreOutcome, summarise, toBaseline, verdicts, type CaseResult, type EvalCase } from "../lib/evals/extraction";
import { expectedIntent, resolveCase } from "../lib/evals/resolve";
import { loadGazetteer } from "../lib/geo/gazetteer";
import type { Resolution } from "../lib/geo/types";

const cases = (JSON.parse(readFileSync(join(__dirname, "../evals/extraction.cases.json"), "utf8")) as { cases: EvalCase[] }).cases;

// The values a case may expect for each field with a fixed list; anything else could never pass.
const props = INTENT_SCHEMA.properties as unknown as Record<string, { enum?: readonly unknown[] }>;
const allowed: Partial<Record<string, readonly unknown[]>> = {
  kind: props.kind.enum,
  landmark_category: props.landmark_category.enum,
  relation: props.relation.enum,
  direction: props.direction.enum,
  language: props.language.enum,
  subject: ["self", "track"],
  track_kind: [...TRACK_KINDS, null],
  track_heading: [...(props.direction.enum ?? [])],
};

describe("extraction eval cases", () => {
  it("are well formed", () => {
    const ids = new Set<string>();
    for (const c of cases) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(Object.keys(AREAS), c.id).toContain(c.area);
      expect(c.text.trim(), c.id).not.toBe("");
      expect(c.tags.length, c.id).toBeGreaterThan(0);
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0);
      for (const [field, want] of Object.entries(c.expect)) {
        expect(SCORED_FIELDS as readonly string[], `${c.id}: unknown field ${field}`).toContain(field);
        const ok = allowed[field];
        if (ok) for (const w of [want].flat()) expect(ok, `${c.id}.${field}`).toContain(w);
      }
    }
  });

  it("name real places in their outcomes and starts", () => {
    const statuses = ["resolved", "ambiguous", "unresolved"];
    for (const c of cases) {
      const ids = new Set(loadGazetteer(c.area).map((f) => f.id));
      const real = (id: string) => ids.has(id) || /^crossing\/-?[\d.]+,-?[\d.]+$/.test(id);
      for (const st of [c.outcome?.status ?? []].flat()) expect(statuses, `${c.id}.outcome.status`).toContain(st);
      for (const id of [c.outcome?.feature_id ?? [], c.outcome?.heading_to ?? [], c.from?.feature ?? [], c.from?.street ?? []].flat()) expect(real(id), `${c.id}: ${id}`).toBe(true);
    }
  });

  it("can all pass: each case's own expectations, as a model reply, score clean, outcome included", () => {
    const now = Date.UTC(2026, 10, 21, 9);
    for (const c of cases) {
      const intent = expectedIntent(c);
      expect(scoreCase(c, intent), c.id).toEqual([]);
      const o = scoreOutcome(c, resolveCase(c, intent, now));
      if (o) expect(o, c.id).toEqual({ misses: [], wrongPin: false });
    }
    // Every case through the resolver: about 3 s for 85 cases, most of it Kyiv name searches, and it
    // grows with the corpus. The 5 s default failed on a loaded machine (21 Nov, 102 cases, 8.5 s).
  }, 30_000);
});

describe("extraction eval scoring", () => {
  it("compares text loosely and lists as any of", () => {
    expect(normText("  Rue de  Fontenay. ")).toBe("rue de fontenay");
    expect(fieldMatches("l'église", "l’Église")).toBe(true);
    expect(fieldMatches(["west", null], null)).toBe(true);
    expect(fieldMatches(["west", null], "east")).toBe(false);
    expect(fieldMatches(500, 500)).toBe(true);
    expect(fieldMatches(500, "500")).toBe(false);
  });

  it("scores only the named fields and counts held-out cases apart", () => {
    const c: EvalCase = { id: "x", area: "vincennes", text: "radio check", tags: ["other"], expect: { kind: "other", relation: null } };
    const wrong = sanitizeIntent({ kind: "position", relation: null, landmark_category: "church" });
    expect(scoreCase(c, wrong)).toEqual([{ field: "kind", want: "other", got: "position" }]);
    expect(inPrompt("Radio check", '"radio check" → {}')).toBe(true);
    const s = summarise([c], [{ id: "x", round: 0, tags: ["other"], inPrompt: true, misses: scoreCase(c, wrong), values: {}, ms: 10 }]);
    expect(s.cases).toEqual({ passed: 0, total: 1 });
    expect(s.inPrompt.total).toBe(1);
    expect(s.fields.kind).toEqual({ passed: 0, total: 1 });
    expect(s.fields.relation).toEqual({ passed: 1, total: 1 });
  });

  const asked = (status: Resolution["status"]): Resolution => ({ status, candidates: [], evidence: { rule: "r", detail: "" } });
  const placed = (id: string): Resolution => ({ status: "resolved", pin: { lat: 0, lon: 0 }, candidates: [], evidence: { rule: "r", detail: "", feature_id: id } });

  it("counts a pin where a question was wanted, or at another place, as a wrong pin", () => {
    const ask: EvalCase = { id: "a", area: "vincennes", text: "", tags: [], expect: {}, outcome: { status: ["ambiguous", "unresolved"] } };
    expect(scoreOutcome(ask, asked("unresolved"))).toEqual({ misses: [], wrongPin: false });
    expect(scoreOutcome(ask, placed("node/1"))!.wrongPin).toBe(true);
    const at: EvalCase = { ...ask, outcome: { status: "resolved", feature_id: "node/1" } };
    expect(scoreOutcome(at, placed("node/1"))).toEqual({ misses: [], wrongPin: false });
    expect(scoreOutcome(at, placed("node/2"))!.wrongPin).toBe(true);
    // A question where a pin was wanted is a miss, not a wrong pin: the speaker is asked.
    expect(scoreOutcome(at, asked("ambiguous"))).toEqual({ misses: [{ what: "status", want: "resolved", got: "ambiguous" }], wrongPin: false });
    expect(scoreOutcome({ ...ask, outcome: undefined }, placed("node/1"))).toBeNull();
  });

  it("judges a case by its majority over rounds, flags flaky cases and changing fields", () => {
    const r = (round: number, ok: boolean, kind: string): CaseResult => ({
      id: "x", round, tags: [], inPrompt: false, values: { kind }, ms: 1,
      misses: ok ? [] : [{ field: "kind", want: "other", got: kind }],
    });
    const [v] = verdicts([r(0, true, "other"), r(1, false, "position"), r(2, true, "other")]);
    expect(v).toMatchObject({ pass: true, flaky: true, passes: 2, rounds: 3, flips: ["kind"] });
  });

  it("compares a run with a baseline", () => {
    const cs: EvalCase[] = ["a", "b", "c"].map((id) => ({ id, area: "vincennes", text: "", tags: [], expect: {} }));
    const res = (id: string, ok: boolean, wrongPin = false): CaseResult => ({
      id, round: 0, tags: [], inPrompt: false, values: {}, ms: 1, misses: ok ? [] : [{ field: "kind", want: "x", got: "y" }],
      outcome: { misses: [], wrongPin },
    });
    const meta = { extractor: "m", prompt_id: promptId(["p"]), at: "", repeat: 1, resolve: true };
    const base = toBaseline(meta, cs, [res("a", true), res("b", false)]);
    const now = toBaseline(meta, cs, [res("a", false, true), res("b", true), res("c", true)]);
    expect(compare(base, now)).toEqual({ regressions: ["a"], improvements: ["b"], newWrongPins: ["a"], added: ["c"], stillFailing: [] });
    expect(promptId(["p"])).not.toBe(promptId(["q"]));
  });
});
