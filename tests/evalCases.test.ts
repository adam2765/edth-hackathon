import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AREAS } from "../lib/geo/areas";
import { TRACK_KINDS } from "../lib/geo/trackKinds";
import { INTENT_SCHEMA, sanitizeIntent } from "../lib/providers/extractor";
import { fieldMatches, inPrompt, normText, SCORED_FIELDS, scoreCase, summarise, type EvalCase } from "../lib/evals/extraction";

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

  it("can all pass: each case's own expectations, as a model reply, score clean", () => {
    for (const c of cases) {
      const first = Object.fromEntries(Object.entries(c.expect).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      const isTrack = first.subject === "track";
      const reply = {
        ...first,
        kind: first.kind ?? "position",
        language: first.language ?? (/\p{Script=Cyrillic}/u.test(c.text) ? "uk" : "en"),
        track: isTrack ? { ref: first.track_ref ?? null, kind: first.track_kind ?? "other", count: first.track_count ?? null, text: null, heading: first.track_heading ?? null } : null,
      };
      expect(scoreCase(c, sanitizeIntent(reply, null, c.text)), c.id).toEqual([]);
    }
  });
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
    const s = summarise([c], [{ id: "x", tags: ["other"], inPrompt: true, misses: scoreCase(c, wrong), ms: 10 }]);
    expect(s.cases).toEqual({ passed: 0, total: 1 });
    expect(s.inPrompt.total).toBe(1);
    expect(s.fields.kind).toEqual({ passed: 0, total: 1 });
    expect(s.fields.relation).toEqual({ passed: 1, total: 1 });
  });
});
