import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Two branches can each add the same next number. Whoever merges second renumbers theirs
// after merging main into the branch (CONTRIBUTING.md, Git workflow); this catches a miss.
describe("DECISIONS.md", () => {
  it("numbers its lines 1 to n with no gaps or repeats", () => {
    const text = readFileSync(new URL("../DECISIONS.md", import.meta.url), "utf8");
    const numbers = [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBeGreaterThan(0);
    const bad = numbers.findIndex((n, i) => n !== i + 1);
    expect(
      bad,
      `decision line ${bad + 1} is numbered ${numbers[bad]}: renumber your new lines after merging main`,
    ).toBe(-1);
  });
});
