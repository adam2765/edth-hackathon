/**
 * Scoring for the intent-extraction eval (`npm run eval:extract`, cases in
 * `evals/extraction.cases.json`). Pure: no network, so the unit tests can check it.
 *
 * A case names only the fields it is sure of. A field it leaves out is not scored. A list
 * means "any of these" (["west", null]). Text is compared without case, extra spaces,
 * end punctuation or curly apostrophes.
 *
 * A case may also name the outcome: what the resolver should answer for the model's intent.
 * That is what the speaker sees, and the only way to count wrong pins.
 */
import { createHash } from "node:crypto";
import type { Intent, Resolution } from "../geo/types";
import type { AreaId } from "../geo/areas";

/** The fields a case may score: the flat Intent the extractor returns, without confidence. */
export const SCORED_FIELDS = [
  "kind",
  "landmark_text",
  "landmark_name",
  "landmark_name_lemma",
  "landmark_category",
  "relation",
  "distance_m",
  "direction",
  "language",
  "subject",
  "track_ref",
  "track_kind",
  "track_count",
  "track_heading",
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

type Value = string | number | null;
export type Expected = Partial<Record<ScoredField, Value | Value[]>>;

/** What the resolver should answer. Ids are gazetteer ids; a list means any of these. */
export interface ExpectedOutcome {
  /** A list means any of these: ["ambiguous", "unresolved"] is "asks back", whatever the question. */
  status?: Resolution["status"] | Resolution["status"][];
  /** The place a resolved answer is at (`evidence.feature_id`). */
  feature_id?: string | string[];
  /** The place a resolved movement is heading to. */
  heading_to?: string | string[];
}

export interface EvalCase {
  id: string;
  area: AreaId;
  text: string;
  /** What kind of case this is: scenario, paraphrase, filler, stt_error, mixed, other, track, adversarial, ... */
  tags: string[];
  expect: Expected;
  /** Scored only with --resolve. */
  outcome?: ExpectedOutcome;
  /**
   * Where the speaker was before, for --resolve: a gazetteer id, the street they were on, and the
   * bearing they were moving on, as the coordinator would send them.
   */
  from?: { feature: string; street?: string; heading_deg?: number };
  /** Why the expectation is what it is, when that is not obvious. */
  note?: string;
}

export interface FieldMiss {
  field: ScoredField;
  want: Value | Value[];
  got: unknown;
}

export function normText(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’`ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'«»“”.,!?;:]+|[\s"'«»“”.,!?;:]+$/g, "");
}

function same(want: Value, got: unknown): boolean {
  if (want === null) return got === null || got === undefined;
  if (typeof want === "number") return got === want;
  return typeof got === "string" && normText(got) === normText(want);
}

/** One expected field against what came back. */
export function fieldMatches(want: Value | Value[], got: unknown): boolean {
  return Array.isArray(want) ? want.some((w) => same(w, got)) : same(want, got);
}

/** The value of a scored field in an intent. Absent `subject` means the speaker. */
export function fieldValue(intent: Intent, field: ScoredField): unknown {
  const got = intent as unknown as Record<string, unknown>;
  return field === "subject" ? (got.subject ?? "self") : (got[field] ?? null);
}

/** The fields of a case that came back wrong; empty when the case passes. */
export function scoreCase(c: EvalCase, intent: Intent): FieldMiss[] {
  const misses: FieldMiss[] = [];
  for (const field of SCORED_FIELDS) {
    if (!(field in c.expect)) continue;
    const want = c.expect[field]!;
    const value = fieldValue(intent, field);
    if (!fieldMatches(want, value)) misses.push({ field, want, got: value });
  }
  return misses;
}

export interface OutcomeScore {
  /** What differed: "status", "feature_id", "heading_to". */
  misses: { what: string; want: unknown; got: unknown }[];
  /**
   * The answer put a pin or a heading on the map, and it is not one the case allows: a place
   * where a question was wanted, or a different place. The worst kind of miss.
   */
  wrongPin: boolean;
}

const anyOf = (want: string | string[], got: string | undefined) => got !== undefined && [want].flat().includes(got);

/** The resolver's answer against the case's expected outcome; null when the case names none. */
export function scoreOutcome(c: EvalCase, r: Resolution): OutcomeScore | null {
  const o = c.outcome;
  if (!o) return null;
  const misses: OutcomeScore["misses"] = [];
  if (o.status && ![o.status].flat().includes(r.status)) misses.push({ what: "status", want: o.status, got: r.status });
  const resolved = r.status === "resolved";
  const place = r.evidence.feature_id;
  const heading = r.heading_to?.id;
  if (resolved && o.feature_id && !anyOf(o.feature_id, place)) misses.push({ what: "feature_id", want: o.feature_id, got: place ?? null });
  if (resolved && o.heading_to && !anyOf(o.heading_to, heading)) misses.push({ what: "heading_to", want: o.heading_to, got: heading ?? null });
  const placed = resolved && (place !== undefined || heading !== undefined || r.pin !== undefined);
  const wrongPin =
    placed &&
    ((o.status !== undefined && ![o.status].flat().includes("resolved")) ||
      (o.feature_id !== undefined && place !== undefined && !anyOf(o.feature_id, place)) ||
      (o.heading_to !== undefined && heading !== undefined && !anyOf(o.heading_to, heading)));
  return { misses, wrongPin };
}

/** True when the case's words are already one of the prompt's examples, so a pass proves less. */
export function inPrompt(text: string, prompt: string): boolean {
  const t = normText(text);
  return t.length > 0 && normText(prompt).includes(t);
}

/** A short id for a prompt and schema, so a saved run says which prompt it scored. */
export function promptId(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 10);
}

export interface CaseResult {
  id: string;
  round: number;
  tags: string[];
  inPrompt: boolean;
  misses: FieldMiss[];
  /** The scored fields as they came back, to see which ones change between rounds. */
  values: Partial<Record<ScoredField, unknown>>;
  /** Set with --resolve when the case names an outcome. */
  outcome?: OutcomeScore;
  /** Set when the call failed (timeout, HTTP error); the case counts as failed. */
  error?: string;
  ms: number;
}

/** Passed: every scored field right, no error, and the outcome right when one was scored. */
export function passed(r: CaseResult): boolean {
  return !r.error && r.misses.length === 0 && (!r.outcome || r.outcome.misses.length === 0);
}

export interface Tally {
  passed: number;
  total: number;
}

/** One case over all its rounds. */
export interface CaseVerdict {
  id: string;
  rounds: number;
  passes: number;
  /** Passed in more than half its rounds. */
  pass: boolean;
  /** Passed in some rounds and failed in others. */
  flaky: boolean;
  /** Scored fields that came back with different values in different rounds. */
  flips: ScoredField[];
  wrongPins: number;
}

export function verdicts(results: CaseResult[]): CaseVerdict[] {
  const by = new Map<string, CaseResult[]>();
  for (const r of results) by.set(r.id, [...(by.get(r.id) ?? []), r]);
  return [...by.entries()].map(([id, rs]) => {
    const passes = rs.filter(passed).length;
    const flips = SCORED_FIELDS.filter((f) => f in rs[0].values && new Set(rs.filter((r) => !r.error).map((r) => JSON.stringify(r.values[f] ?? null))).size > 1);
    return { id, rounds: rs.length, passes, pass: passes * 2 > rs.length, flaky: passes > 0 && passes < rs.length, flips, wrongPins: rs.filter((r) => r.outcome?.wrongPin).length };
  });
}

export interface Summary {
  /** Results, one per case and round. */
  cases: Tally;
  heldOut: Tally;
  inPrompt: Tally;
  fields: Record<string, Tally>;
  tags: Record<string, Tally>;
  /** Results that scored an outcome, and how many of those were right. */
  outcomes: Tally;
  /** Results whose answer put a wrong pin or heading on the map. */
  wrongPins: number;
  /** Cases that passed in some rounds and failed in others. */
  flaky: number;
  medianMs: number;
  p90Ms: number;
}

function add(t: Record<string, Tally>, key: string, ok: boolean) {
  t[key] ??= { passed: 0, total: 0 };
  t[key].total++;
  if (ok) t[key].passed++;
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function summarise(cases: EvalCase[], results: CaseResult[]): Summary {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const fields: Record<string, Tally> = {};
  const tags: Record<string, Tally> = {};
  const groups: Record<string, Tally> = {};
  let wrongPins = 0;
  for (const r of results) {
    const ok = passed(r);
    add(groups, "cases", ok);
    add(groups, r.inPrompt ? "inPrompt" : "heldOut", ok);
    for (const tag of r.tags) add(tags, tag, ok);
    const c = byId.get(r.id);
    for (const field of Object.keys(c?.expect ?? {})) add(fields, field, !r.error && !r.misses.some((m) => m.field === field));
    if (r.outcome) {
      add(groups, "outcomes", r.outcome.misses.length === 0);
      if (r.outcome.wrongPin) wrongPins++;
    }
  }
  const ms = results.filter((r) => !r.error).map((r) => r.ms);
  const zero = { passed: 0, total: 0 };
  return {
    cases: groups.cases ?? zero,
    heldOut: groups.heldOut ?? zero,
    inPrompt: groups.inPrompt ?? zero,
    fields,
    tags,
    outcomes: groups.outcomes ?? zero,
    wrongPins,
    flaky: verdicts(results).filter((v) => v.flaky).length,
    medianMs: quantile(ms, 0.5),
    p90Ms: quantile(ms, 0.9),
  };
}

/** A committed run to compare with: one per extractor, in evals/baselines/. */
export interface Baseline {
  extractor: string;
  prompt_id: string;
  at: string;
  repeat: number;
  resolve: boolean;
  summary: Summary;
  cases: Record<string, { pass: boolean; passes: number; rounds: number; wrong_pins: number }>;
}

export function toBaseline(meta: Omit<Baseline, "summary" | "cases">, cases: EvalCase[], results: CaseResult[]): Baseline {
  const out: Baseline["cases"] = {};
  for (const v of verdicts(results)) out[v.id] = { pass: v.pass, passes: v.passes, rounds: v.rounds, wrong_pins: v.wrongPins };
  return { ...meta, summary: summarise(cases, results), cases: out };
}

export interface Comparison {
  /** Passed in the baseline, fails now. A prompt change must not bring any without a reason. */
  regressions: string[];
  /** Failed in the baseline, passes now. */
  improvements: string[];
  /** Gave no wrong pin in the baseline, gives one now. */
  newWrongPins: string[];
  /** Cases not in the baseline: new cases, or ones run with a filter the baseline did not use. */
  added: string[];
  stillFailing: string[];
}

/** This run against a baseline. Only cases in both are compared; a case counts by its majority verdict. */
export function compare(base: Baseline, now: Baseline): Comparison {
  const c: Comparison = { regressions: [], improvements: [], newWrongPins: [], added: [], stillFailing: [] };
  for (const [id, v] of Object.entries(now.cases)) {
    const b = base.cases[id];
    if (!b) c.added.push(id);
    else if (b.pass && !v.pass) c.regressions.push(id);
    else if (!b.pass && v.pass) c.improvements.push(id);
    else if (!v.pass) c.stillFailing.push(id);
    if (b && b.wrong_pins === 0 && v.wrong_pins > 0) c.newWrongPins.push(id);
  }
  return c;
}
