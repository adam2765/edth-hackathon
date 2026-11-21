/**
 * Scoring for the reply eval (evals/replies.cases.json): what a reply to an open question does,
 * as the reply reader labels it. Pure, so `npm test` checks the cases file without a model.
 */
import { REPLY_KINDS, type OpenQuestion, type QuestionChoice, type ReplyKind, type ReplyReading } from "../providers/replies";

export interface ReplyQuestion extends OpenQuestion {
  area: "vincennes" | "kyiv" | "izium";
  lang: "en" | "fr" | "uk";
  /** Each choice keeps its gazetteer or crossing id, as the coordinator's candidates do. */
  choices: (QuestionChoice & { id: string })[];
}

export interface ReplyCase {
  id: string;
  /** A key of `questions`. */
  question: string;
  /** `fast`: words code alone could settle. `tail`: needs a reading. `trap`: built to catch one mistake. */
  tags: string[];
  /** The reply as speech-to-text would write it. */
  reply: string;
  /** A list of kinds means any of these. `choice` is scored only when the reader says pick. */
  expect: { kind: ReplyKind | ReplyKind[]; choice?: number };
  note?: string;
}

export interface ReplyCasesFile {
  questions: Record<string, ReplyQuestion>;
  cases: ReplyCase[];
}

/**
 * The misses that cost more than one more question:
 *   wrong_pick       a choice the speaker did not mean: a marker in the wrong place.
 *   wrong_subject    for a question about a track, a reply about the speaker read as the track's
 *                    place, or the other way round: the wrong marker moves.
 *   wrong_disregard  a report withdrawn that the speaker did not withdraw.
 */
export type Costly = "wrong_pick" | "wrong_subject" | "wrong_disregard";

export const expectedKinds = (c: ReplyCase): ReplyKind[] => (Array.isArray(c.expect.kind) ? c.expect.kind : [c.expect.kind]);

export function scoreReply(c: ReplyCase, q: ReplyQuestion, got: ReplyReading): { pass: boolean; costly: Costly | null } {
  const kinds = expectedKinds(c);
  if (got.kind === "pick") {
    const pass = kinds.includes("pick") && got.choice === c.expect.choice;
    return { pass, costly: pass ? null : "wrong_pick" };
  }
  if (kinds.includes(got.kind)) return { pass: true, costly: null };
  if (got.kind === "disregard") return { pass: false, costly: "wrong_disregard" };
  const track = q.about !== "self";
  const swapped =
    (got.kind === "rephrase" && kinds.includes("new_report")) || (got.kind === "new_report" && kinds.includes("rephrase"));
  return { pass: false, costly: track && swapped ? "wrong_subject" : null };
}

/** Problems with the cases file itself, for `npm test`. Empty when it is sound. */
export function checkCasesFile(file: ReplyCasesFile): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const [key, q] of Object.entries(file.questions)) {
    if (!q.choices.length) out.push(`${key}: no choices`);
    if (q.about !== "self" && !(Number.isInteger(q.about.track) && q.about.track > 0)) out.push(`${key}: a track question needs a track number`);
  }
  for (const c of file.cases) {
    if (ids.has(c.id)) out.push(`${c.id}: id used twice`);
    ids.add(c.id);
    const q = file.questions[c.question];
    if (!q) {
      out.push(`${c.id}: no question ${c.question}`);
      continue;
    }
    const kinds = expectedKinds(c);
    for (const k of kinds) if (!REPLY_KINDS.includes(k)) out.push(`${c.id}: unknown kind ${k}`);
    if (kinds.includes("pick")) {
      const n = c.expect.choice;
      if (!(Number.isInteger(n) && n! >= 1 && n! <= q.choices.length)) out.push(`${c.id}: a pick needs a choice from 1 to ${q.choices.length}`);
    } else if (c.expect.choice != null) out.push(`${c.id}: a choice without pick`);
    if (!c.tags.some((t) => t === "fast" || t === "tail" || t === "trap")) out.push(`${c.id}: tag it fast, tail or trap`);
    if (!c.reply.trim()) out.push(`${c.id}: empty reply`);
  }
  return out;
}

export interface ReplyResult {
  id: string;
  round: number;
  kind: ReplyKind | null;
  choice: number | null;
  pass: boolean;
  costly: Costly | null;
  ms: number;
  error?: string;
}

export interface Tally {
  passed: number;
  total: number;
}

const add = (m: Map<string, Tally>, key: string, pass: boolean) => {
  const t = m.get(key) ?? { passed: 0, total: 0 };
  t.total++;
  if (pass) t.passed++;
  m.set(key, t);
};

export interface ReplySummary {
  overall: Tally;
  byKind: Map<string, Tally>;
  byLang: Map<string, Tally>;
  byTag: Map<string, Tally>;
  /** Expected kind (the first one listed) → what the reader said, counted. */
  confusion: Map<string, Map<string, number>>;
  costly: ReplyResult[];
  flaky: string[];
  medianMs: number;
  p90Ms: number;
  errors: number;
}

export function summariseReplies(file: ReplyCasesFile, cases: ReplyCase[], results: ReplyResult[]): ReplySummary {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const overall: Tally = { passed: 0, total: 0 };
  const byKind = new Map<string, Tally>();
  const byLang = new Map<string, Tally>();
  const byTag = new Map<string, Tally>();
  const confusion = new Map<string, Map<string, number>>();
  for (const r of results) {
    const c = byId.get(r.id)!;
    overall.total++;
    if (r.pass) overall.passed++;
    const want = expectedKinds(c)[0];
    add(byKind, want, r.pass);
    add(byLang, file.questions[c.question].lang, r.pass);
    for (const t of c.tags) add(byTag, t, r.pass);
    const row = confusion.get(want) ?? new Map<string, number>();
    const got = r.kind ?? "error";
    row.set(got, (row.get(got) ?? 0) + 1);
    confusion.set(want, row);
  }
  const verdictsById = new Map<string, Set<boolean>>();
  for (const r of results) verdictsById.set(r.id, (verdictsById.get(r.id) ?? new Set()).add(r.pass));
  const flaky = [...verdictsById].filter(([, v]) => v.size > 1).map(([id]) => id);
  const ms = results.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const at = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0);
  return {
    overall,
    byKind,
    byLang,
    byTag,
    confusion,
    costly: results.filter((r) => r.costly),
    flaky,
    medianMs: at(0.5),
    p90Ms: at(0.9),
    errors: results.filter((r) => r.error).length,
  };
}

export interface ReplyBaseline {
  reader: string;
  prompt_id: string;
  at: string;
  repeat: number;
  /** Each case's verdict by majority over its rounds, and its costly miss if any round had one. */
  cases: Record<string, { pass: boolean; costly: Costly | null }>;
}

export function toReplyBaseline(meta: Omit<ReplyBaseline, "cases">, results: ReplyResult[]): ReplyBaseline {
  const by = new Map<string, ReplyResult[]>();
  for (const r of results) by.set(r.id, [...(by.get(r.id) ?? []), r]);
  const cases: ReplyBaseline["cases"] = {};
  for (const [id, rs] of by) {
    const passed = rs.filter((r) => r.pass).length;
    cases[id] = { pass: passed * 2 > rs.length, costly: rs.find((r) => r.costly)?.costly ?? null };
  }
  return { ...meta, cases };
}

export function compareReplies(base: ReplyBaseline, run: ReplyBaseline): { regressions: string[]; newCostly: string[]; improvements: string[]; unseen: string[] } {
  const regressions: string[] = [];
  const newCostly: string[] = [];
  const improvements: string[] = [];
  const unseen: string[] = [];
  for (const [id, now] of Object.entries(run.cases)) {
    const was = base.cases[id];
    if (!was) {
      unseen.push(id);
      continue;
    }
    if (was.pass && !now.pass) regressions.push(id);
    if (!was.pass && now.pass) improvements.push(id);
    if (now.costly && !was.costly) newCostly.push(id);
  }
  return { regressions, newCostly, improvements, unseen };
}
