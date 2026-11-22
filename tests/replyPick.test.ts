import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchCallsign } from "../lib/geo/callsigns";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { readPick, type PickChoice } from "../lib/geo/replies";
import type { Category } from "../lib/geo/types";
import { expectedKinds, type ReplyCase, type ReplyCasesFile, type ReplyQuestion } from "../lib/evals/replies";
import { afterCallsign, withoutClosing } from "../lib/reports/radio";

// A spoken answer read in code [244]: the closed forms only, and never a wrong choice.

const file = JSON.parse(readFileSync(join(__dirname, "../evals/replies.cases.json"), "utf8")) as ReplyCasesFile;
const ROSTER = ["ALPHA 1", "ALPHA 2", "BRAVO 2", "CHARLIE 3"];

const categories = new Map<string, Map<string, Category>>();
function categoryOf(q: ReplyQuestion, id: string): Category {
  if (id.startsWith("crossing/")) return "intersection";
  if (id.startsWith("street/")) return "street";
  let byId = categories.get(q.area);
  if (!byId) categories.set(q.area, (byId = new Map(loadGazetteer(q.area).map((f) => [f.id, f.category]))));
  const c = byId.get(id);
  if (!c) throw new Error(`no place ${id} in ${q.area}`);
  return c;
}

/** The question's choices as the coordinator's candidates give them: name, category, distance. */
const choicesOf = (q: ReplyQuestion): PickChoice[] => q.choices.map((c) => ({ name: c.name, category: categoryOf(q, c.id), town: c.town, distance_m: c.distance_m }));

/** The words the reader gets: the reply after the sender's call sign, without "over", as in the report endpoint. */
function heard(reply: string): string {
  const m = matchCallsign(reply, ROSTER);
  return withoutClosing(afterCallsign(reply, m.kind === "unit" ? m.heard : null));
}

const read = (c: ReplyCase) => readPick(heard(c.reply), choicesOf(file.questions[c.question]));
const wantsPick = (c: ReplyCase) => expectedKinds(c).includes("pick");

describe("a spoken answer read in code, on the reply eval's cases", () => {
  it("never picks a choice the speaker did not mean", () => {
    const wrong = file.cases.flatMap((c) => {
      const got = read(c);
      if (!got) return [];
      return wantsPick(c) && got.choice === c.expect.choice ? [] : [`${c.id}: “${c.reply}” read as choice ${got.choice}`];
    });
    expect(wrong).toEqual([]);
  });

  it("settles every pick tagged fast: a number, a name or kind, yes to one choice", () => {
    const fast = file.cases.filter((c) => c.tags.includes("fast") && c.expect.kind === "pick");
    expect(fast.length).toBe(33);
    expect(fast.filter((c) => read(c)?.choice !== c.expect.choice).map((c) => `${c.id}: “${c.reply}”`)).toEqual([]);
  });

  it("settles some of the tail too, and leaves the rest to be read as a report", () => {
    const tail = file.cases.filter((c) => !c.tags.includes("fast") && wantsPick(c));
    const settled = tail.filter((c) => read(c)?.choice === c.expect.choice).map((c) => c.reply);
    // The count is the measure in docs/ask-back.md: change both together.
    expect(tail.length).toBe(25);
    expect(settled).toEqual(expect.arrayContaining(["No, the second one.", "Celle de Saint-Mandé.", "The closer one.", "La plus proche.", "Та, що ближче.", "Над фунікулером.", "Вторая, станция."]));
    expect(settled.length).toBe(14);
  });

  it("reads nothing into a reply that is not a pick", () => {
    const others = file.cases.filter((c) => !wantsPick(c));
    expect(others.length).toBeGreaterThan(60);
    expect(others.filter((c) => read(c) != null).map((c) => c.reply)).toEqual([]);
  });
});

describe("on replies written without seeing the reader", () => {
  // 80 replies an agent wrote from the rule alone on 22 Nov, to make the reader pick wrongly. The
  // first run picked wrongly three times ("Les deux.", "Лікарня.", "У парку."); those are fixed, so
  // these cases are no longer unseen. They stay as a guard.
  interface Held {
    id: string;
    question: string;
    reply: string;
    expect: "pick" | "none";
    /** The choice meant; for an ambiguous case, the one a person would lean to, or null. */
    choice: number | null;
    /** A person could argue either way: nothing, or the choice leaned to. Never another choice. */
    ambiguous?: boolean;
  }
  const held = (JSON.parse(readFileSync(join(__dirname, "../evals/replies.heldout.cases.json"), "utf8")) as { cases: Held[] }).cases;
  const readHeld = (c: Held) => readPick(withoutClosing(c.reply), choicesOf(file.questions[c.question]));

  it("uses the reply eval's questions, and none of its replies", () => {
    expect(held.length).toBe(80);
    const seen = new Set(file.cases.map((c) => c.reply));
    for (const c of held) {
      expect(file.questions[c.question], c.id).toBeDefined();
      expect(seen.has(c.reply), c.id).toBe(false);
    }
  });

  it("never picks a choice that was not meant", () => {
    const wrong = held.flatMap((c) => {
      const got = readHeld(c);
      if (!got) return [];
      const fine = got.choice === c.choice && (c.expect === "pick" || c.ambiguous === true);
      return fine ? [] : [`${c.id}: “${c.reply}” read as choice ${got.choice}`];
    });
    expect(wrong).toEqual([]);
  });

  it("settles all but one of the clear picks", () => {
    const picks = held.filter((c) => c.expect === "pick" && !c.ambiguous);
    expect(picks.length).toBe(29);
    // "узвіз" for "узвозом": the vowel changes with the case, and the reader does not follow it.
    expect(picks.filter((c) => readHeld(c)?.choice !== c.choice).map((c) => c.reply)).toEqual(["Володимирський узвіз."]);
  });
});

describe("the closed forms", () => {
  const castle: PickChoice[] = [
    { name: "Château de Vincennes", category: "metro_station", distance_m: 304 },
    { name: "Château de Vincennes", category: "castle", distance_m: 312 },
  ];
  const halls: PickChoice[] = [
    { name: "Mairie de Vincennes", category: "town_hall", distance_m: 423 },
    { name: "Mairie de Saint-Mandé", category: "town_hall", distance_m: 1188 },
  ];
  const one: PickChoice[] = [{ name: "Bérault", category: "metro_station", distance_m: 417 }];

  it("a number, an ordinal, the last one", () => {
    expect(readPick("Two.", castle)).toEqual({ choice: 2, how: "number" });
    expect(readPick("number one", castle)).toEqual({ choice: 1, how: "number" });
    expect(readPick("the second one", castle)).toEqual({ choice: 2, how: "number" });
    expect(readPick("le dernier", castle)).toEqual({ choice: 2, how: "number" });
    expect(readPick("2", castle)).toEqual({ choice: 2, how: "number" });
    // More than were offered, or a count of something.
    expect(readPick("three", castle)).toBeNull();
    expect(readPick("two blocks east", castle)).toBeNull();
    expect(readPick("two enemy vehicles", castle)).toBeNull();
    // A wait, not the second choice.
    expect(readPick("one second", castle)).toBeNull();
    expect(readPick("just a second", castle)).toBeNull();
    expect(readPick("une seconde", castle)).toBeNull();
    expect(readPick("la seconde", castle)).toEqual({ choice: 2, how: "number" });
    // Both of them, not the second.
    expect(readPick("les deux", castle)).toBeNull();
    expect(readPick("both", castle)).toBeNull();
  });

  it("the kind they all are is the question's own word, unless the names set one kind against another", () => {
    const hospitals: PickChoice[] = [
      { name: "Міська", category: "hospital", distance_m: 36 },
      { name: "Центральна районна лікарня", category: "hospital", distance_m: 420 },
    ];
    const churches: PickChoice[] = [
      { name: "Спасо-Преображенський собор", category: "church", distance_m: 342 },
      { name: "Хрестовоздвиженська церква", category: "church", distance_m: 624 },
    ];
    expect(readPick("Лікарня.", hospitals)).toBeNull();
    expect(readPick("Міська лікарня.", hospitals)).toEqual({ choice: 1, how: "name" });
    expect(readPick("Собор.", churches)).toEqual({ choice: 1, how: "name" });
    // "У парку" is a park, not Парковий міст.
    expect(readPick("У парку.", [{ name: "Парковий міст", category: "bridge" }, { name: "Київський фунікулер", category: "bridge" }])).toBeNull();
  });

  it("the kind, when it tells the choices apart; a name both share tells nothing", () => {
    expect(readPick("the metro station", castle)).toEqual({ choice: 1, how: "name" });
    expect(readPick("the castle", castle)).toEqual({ choice: 2, how: "name" });
    expect(readPick("le château", castle)).toEqual({ choice: 2, how: "name" });
    expect(readPick("Château de Vincennes", castle)).toBeNull();
    expect(readPick("the town hall", halls)).toBeNull();
  });

  it("part of a name, the nearer one, and yes to one choice only", () => {
    expect(readPick("Saint-Mandé", halls)).toEqual({ choice: 2, how: "name" });
    expect(readPick("the closer one", halls)).toEqual({ choice: 1, how: "nearest" });
    // 304 m and 312 m: neither is the closer one.
    expect(readPick("the closer one", castle)).toBeNull();
    expect(readPick("yes", one)).toEqual({ choice: 1, how: "yes" });
    expect(readPick("yes", halls)).toBeNull();
    expect(readPick("Bérault", one)).toEqual({ choice: 1, how: "name" });
  });

  it("a reply that says who it is about, or more than an answer, is not read here", () => {
    expect(readPick("I'm at the castle", castle)).toBeNull();
    expect(readPick("je suis au château", castle)).toBeNull();
    expect(readPick("я біля замку", castle)).toBeNull();
    expect(readPick("not the castle", castle)).toBeNull();
    expect(readPick("the castle, moving north", castle)).toBeNull();
    expect(readPick("", castle)).toBeNull();
    expect(readPick("uh", castle)).toBeNull();
  });
});
