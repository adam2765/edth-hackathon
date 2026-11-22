/**
 * The call-sign eval [200]: each case is a transcript and what `matchCallsign` should answer for
 * it, against one roster. No model, so it runs in `npm test` as well as `npm run eval:callsigns`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchCallsign, type CallsignMatch } from "../geo/callsigns";

export interface CallsignCase {
  id: string;
  tags?: string[];
  text: string;
  /**
   * Only the fields given are scored. `candidates` is compared as a set; `read: null` means no call
   * sign read; `signoff` says whether the call sign was read at the end of the transmission [237],
   * which is always a question for the operator (`ask`), with the one unit it may be.
   */
  expect: { kind: CallsignMatch["kind"]; callsign?: string; how?: "exact" | "near"; candidates?: string[]; read?: string | null; signoff?: boolean };
  note?: string;
}

export interface CallsignEval {
  about?: string;
  roster: string[];
  cases: CallsignCase[];
}

export interface CallsignScore {
  id: string;
  pass: boolean;
  /** The worst miss: a unit named where the case wants a question, no unit or another unit. That unit would move. */
  wrongUnit: boolean;
  misses: string[];
  got: CallsignMatch;
}

export const CALLSIGN_CASES = join(__dirname, "../../evals/callsigns.cases.json");

export function loadCallsignEval(file = CALLSIGN_CASES): CallsignEval {
  return JSON.parse(readFileSync(file, "utf8")) as CallsignEval;
}

export function scoreCallsignCase(c: CallsignCase, roster: string[]): CallsignScore {
  const got = matchCallsign(c.text, roster);
  const want = c.expect;
  const misses: string[] = [];
  if (got.kind !== want.kind) misses.push(`kind ${got.kind}, wanted ${want.kind}`);
  if (want.callsign != null && (got.kind !== "unit" || got.callsign !== want.callsign)) misses.push(`callsign ${got.kind === "unit" ? got.callsign : "none"}, wanted ${want.callsign}`);
  if (want.how != null && got.kind === "unit" && got.how !== want.how) misses.push(`how ${got.how}, wanted ${want.how}`);
  if (want.candidates != null) {
    const have = got.kind === "ask" ? [...got.candidates].sort() : [];
    if (JSON.stringify(have) !== JSON.stringify([...want.candidates].sort())) misses.push(`candidates ${have.join(", ") || "none"}, wanted ${want.candidates.join(", ")}`);
  }
  if (want.read !== undefined) {
    const read = got.kind === "unassigned" ? got.read : null;
    if (read !== want.read) misses.push(`read ${read ?? "nothing"}, wanted ${want.read ?? "nothing"}`);
  }
  if (want.signoff != null) {
    const signoff = got.kind === "ask" && got.signoff === true;
    if (signoff !== want.signoff) misses.push(`${signoff ? "read at the end" : "not read at the end"}, wanted ${want.signoff ? "a sign-off" : "the start"}`);
  }
  const wrongUnit = got.kind === "unit" && (want.kind !== "unit" || (want.callsign != null && want.callsign !== got.callsign));
  return { id: c.id, pass: misses.length === 0, wrongUnit, misses, got };
}
