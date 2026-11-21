/**
 * Scoring for the intent-extraction eval (`npm run eval:extract`, cases in
 * `evals/extraction.cases.json`). Pure: no network, so the unit tests can check it.
 *
 * A case names only the fields it is sure of. A field it leaves out is not scored. A list
 * means "any of these" (["west", null]). Text is compared without case, extra spaces,
 * end punctuation or curly apostrophes.
 */
import type { Intent } from "../geo/types";
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

export interface EvalCase {
  id: string;
  area: AreaId;
  text: string;
  /** What kind of case this is: scenario, paraphrase, filler, stt_error, mixed, other, track, ... */
  tags: string[];
  expect: Expected;
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

/** The fields of a case that came back wrong; empty when the case passes. */
export function scoreCase(c: EvalCase, intent: Intent): FieldMiss[] {
  const got = intent as unknown as Record<string, unknown>;
  const misses: FieldMiss[] = [];
  for (const field of SCORED_FIELDS) {
    if (!(field in c.expect)) continue;
    const want = c.expect[field]!;
    // An intent about the speaker carries no subject field in older code; absent means "self".
    const value = field === "subject" ? (got.subject ?? "self") : got[field];
    if (!fieldMatches(want, value)) misses.push({ field, want, got: value ?? null });
  }
  return misses;
}

/** True when the case's words are already one of the prompt's examples, so a pass proves less. */
export function inPrompt(text: string, prompt: string): boolean {
  const t = normText(text);
  return t.length > 0 && normText(prompt).includes(t);
}

export interface CaseResult {
  id: string;
  tags: string[];
  inPrompt: boolean;
  misses: FieldMiss[];
  /** Set when the call failed (timeout, HTTP error); the case counts as failed. */
  error?: string;
  ms: number;
}

export interface Tally {
  passed: number;
  total: number;
}

export interface Summary {
  cases: Tally;
  heldOut: Tally;
  inPrompt: Tally;
  fields: Record<string, Tally>;
  tags: Record<string, Tally>;
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
  for (const r of results) {
    const ok = !r.error && r.misses.length === 0;
    add(groups, "cases", ok);
    add(groups, r.inPrompt ? "inPrompt" : "heldOut", ok);
    for (const tag of r.tags) add(tags, tag, ok);
    const c = byId.get(r.id);
    for (const field of Object.keys(c?.expect ?? {})) add(fields, field, !r.error && !r.misses.some((m) => m.field === field));
  }
  const ms = results.filter((r) => !r.error).map((r) => r.ms);
  const zero = { passed: 0, total: 0 };
  return {
    cases: groups.cases ?? zero,
    heldOut: groups.heldOut ?? zero,
    inPrompt: groups.inPrompt ?? zero,
    fields,
    tags,
    medianMs: quantile(ms, 0.5),
    p90Ms: quantile(ms, 0.9),
  };
}
