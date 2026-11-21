import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = readFileSync(new URL("../DECISIONS.md", import.meta.url), "utf8");
const entries = [...text.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => ({ n: Number(m[1]), line: m[2] }));
const lines = new Map(entries.map((e) => [e.n, e.line]));

/** "21, 30 and 46" → [21, 30, 46] */
const numbers = (list: string) => list.split(/, | and |,/).map(Number);
const LIST = String.raw`\d+(?:(?:, ?| and )\d+)*`;

/** The later lines an old line says replaced or changed it: its leading **Replaced by N.** or **Changed by N.** */
function changedBy(line: string): number[] {
  const head = line.match(new RegExp(String.raw`^\*\*((?:(?:Replaced|Changed) by ${LIST}\. ?)+)\*\*`));
  if (!head) return [];
  return [...head[1].matchAll(new RegExp(`(?:Replaced|Changed) by (${LIST})\\.`, "g"))].flatMap((m) => numbers(m[1]));
}

/** The decisions a line names at all: "decision 21", "decisions 10 and 21", "[98]", "[153, 159]". */
function cites(line: string): number[] {
  const words = [...line.matchAll(new RegExp(`\\bdecisions? (${LIST})`, "gi"))].map((m) => m[1]);
  const brackets = [...line.matchAll(new RegExp(`\\[(${LIST})\\]`, "g"))].map((m) => m[1]);
  return [...words, ...brackets].flatMap(numbers);
}

/** The decisions a line says it replaces or changes: "replaces decision 21", "this changes decision 49", "settles the open point of decision 45". */
function claimsToChange(line: string): number[] {
  return [...line.matchAll(new RegExp(`\\b(?:replaces|changes|settles)\\b[^.;:()]*?\\bdecisions? (${LIST})`, "gi"))].flatMap(
    (m) => numbers(m[1]),
  );
}

// Two branches can each add the same next number. Whoever merges second renumbers theirs
// after merging main into the branch (CONTRIBUTING.md, Git workflow); this catches a miss.
describe("DECISIONS.md", () => {
  it("numbers its lines 1 to n with no gaps or repeats", () => {
    expect(entries.length).toBeGreaterThan(0);
    const bad = entries.findIndex((e, i) => e.n !== i + 1);
    expect(
      bad,
      `decision line ${bad + 1} is numbered ${entries[bad]?.n}: renumber your new lines after merging main`,
    ).toBe(-1);
  });

  // When a decision replaces or changes an earlier one, both lines say so (CONTRIBUTING.md, Decision numbers).
  it("links a changed decision and the one that changed it, both ways", () => {
    const problems: string[] = [];
    for (const { n, line } of entries) {
      const marked = changedBy(line);
      if (/\b(?:Replaced|Changed) by \d/.test(line.replace(/^\*\*[^*]*\*\*/, ""))) {
        problems.push(`${n}: put "Replaced by" or "Changed by" at the start of the line, in bold`);
      }
      for (const m of marked) {
        const later = lines.get(m);
        if (later === undefined) problems.push(`${n} says changed by ${m}, and there is no decision ${m}`);
        else if (m <= n) problems.push(`${n} says changed by ${m}, which is not a later line`);
        else if (!cites(later).includes(n)) {
          problems.push(`${n} says changed by ${m}, but ${m} does not name it: write "changes decision ${n}" in ${m}`);
        }
      }
      for (const old of claimsToChange(line)) {
        const earlier = lines.get(old);
        if (earlier === undefined) problems.push(`${n} changes decision ${old}, and there is no decision ${old}`);
        else if (!changedBy(earlier).includes(n)) {
          problems.push(`${n} changes decision ${old}: start line ${old} with **Changed by ${n}.** or **Replaced by ${n}.**`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
