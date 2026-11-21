/**
 * Rewrites an eval cases file in its house style: one case per line, so a new case is a
 * one-line diff. `npm run eval:format` (default evals/extraction.cases.json) or a path.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return parts.length ? `{ ${parts.join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}

const file = resolve(join(__dirname, ".."), process.argv[2] ?? "evals/extraction.cases.json");
const doc = JSON.parse(readFileSync(file, "utf8")) as { about?: string; cases: { id: string }[] };
const ids = new Set<string>();
for (const c of doc.cases) {
  if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
  ids.add(c.id);
}
const head = Object.entries(doc)
  .filter(([k]) => k !== "cases")
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
const body = doc.cases.map((c, i) => `    ${inline(c)}${i < doc.cases.length - 1 ? "," : ""}`);
writeFileSync(file, ["{", ...head, '  "cases": [', ...body, "  ]", "}", ""].join("\n"));
console.log(`${doc.cases.length} cases written to ${file}`);
