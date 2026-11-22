/**
 * A spoken answer to an open question, read in code [243]. On a radio net the operator asks the
 * question and the unit answers in a few words: "two", "the metro station", "Saint-Mandé", "yes".
 * This reads only those closed forms, and only as a pick of one of the choices on offer:
 *   - a number or an ordinal ("two", "the second one", "numéro deux", "другий", "the last one");
 *   - words that name one choice and no other: part of its name, its town, or its kind;
 *   - "the closer one" or "the one further away", when the choices are clearly not as far;
 *   - "yes" or "affirm", when there is only one choice.
 * Every word has to be one of these or a filler, so "two blocks east", "two enemy vehicles" and
 * "I'm at the town hall" are not answers: they are read as reports, as before. A reply that says
 * who it is about ("I", "je", "я") stands on its own and is never read here.
 *
 * It picks nothing by itself: the coordinator stores what it heard, and the command post shows the
 * choice already picked for the operator to confirm. No model is involved, and the place is the
 * stored choice's. Measured on evals/replies.cases.json in tests/replyPick.test.ts.
 */
import { canonTokens, isCategoryWord } from "./gazetteer";
import { normalize } from "./normalize";
import type { Candidate } from "./types";

/** What the reader needs of a choice: the fields of the question's candidates. */
export type PickChoice = Pick<Candidate, "name" | "category"> & { town?: string; distance_m?: number };

/** How a spoken answer named its choice. The same words as `HeardHow` in lib/reports/types.ts, which the log keeps. */
export type PickHow = "number" | "name" | "nearest" | "yes";

export interface HeardPick {
  /** The choice, counting from 1, as on the operator's screen. */
  choice: number;
  how: PickHow;
}

/** A reply longer than this is a sentence, not an answer. */
const MAX_WORDS = 8;
/** "The closer one" needs the nearest choice to be this much nearer than the next, in metres and as a share. */
const NEARER_BY_M = 50;
const NEARER_BY_SHARE = 0.2;

const CARDINALS: Record<string, number> = {
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9,
  два: 2, дві: 2, три: 3, чотири: 4, пять: 5, шість: 6, сім: 7, вісім: 8, девять: 9,
  две: 2, четыре: 4, шесть: 6, семь: 7, восемь: 8,
};
/** "One" is also a filler ("the north one") and an article ("une"): a number only alone, or after "number". */
const ONES = new Set(["one", "un", "une", "один", "одна", "одне", "одно"]);
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
  premier: 1, premiere: 1, deuxieme: 2, troisieme: 3, quatrieme: 4, cinquieme: 5,
  перший: 1, перша: 1, перше: 1, першу: 1, першого: 1, другий: 2, друга: 2, друге: 2, другу: 2, другого: 2,
  третій: 3, третя: 3, третє: 3, третю: 3, третього: 3, четвертий: 4, четверта: 4, четверту: 4, пятий: 5, пята: 5,
  первый: 1, первая: 1, первое: 1, первую: 1, второй: 2, вторая: 2, второе: 2, вторую: 2, третий: 3, третья: 3, третье: 3, третью: 3, четвертый: 4, четвертая: 4,
};
const LAST = new Set(["last", "dernier", "derniere", "останній", "остання", "останнє", "останню", "последний", "последняя", "последнюю"]);
/** "Number two", "choice 2", "numéro deux", "номер два". */
const NUMBER_LEAD = new Set(["number", "no", "choice", "option", "numero", "num", "choix", "номер", "варіант", "вариант"]);
/** "A second", "one second", "just a second": a wait, not the second choice. */
const BEFORE_SECOND = new Set(["a", "one", "just", "wait", "quick", "half"]);

const YES = new Set([
  "yes", "yeah", "yep", "yup", "affirm", "affirmative", "correct", "right",
  "oui", "ouais", "affirmatif", "exact", "exactement",
  "так", "да", "ага", "вірно", "правильно", "підтверджую", "верно", "подтверждаю",
]);

const NEARER = new Set(["closer", "closest", "nearer", "nearest", "proche", "proches", "ближче", "ближча", "ближчий", "найближча", "найближчий", "ближня", "ближній", "ближе", "ближайший", "ближайшая"]);
const FARTHER = new Set(["further", "farther", "furthest", "farthest", "loin", "lointain", "lointaine", "далі", "дальша", "дальший", "найдальша", "найдальший", "дальше", "дальний", "дальняя"]);

/**
 * Words that say nothing about which choice. Not "not" ("not the castle" is no pick of the castle),
 * and no word for the speaker: "I", "je", "я" make the reply a report of its own.
 */
const FILLER = new Set([
  "one", "ones", "it", "its", "is", "s", "that", "thats", "this", "there", "mine", "ours", "away", "please", "ok", "okay", "uh", "um", "er", "eh", "no", "nope", "over", "out",
  "un", "une", "ca", "cela", "celui", "celle", "ceux", "celles", "plus", "non", "euh", "ben", "bah", "alors", "donc", "hein", "termine",
  "це", "оце", "той", "та", "те", "ті", "що", "ну", "е", "ее", "ні", "нет", "точно", "прийом", "прием", "над", "коло", "возле", "около",
]);

/** Compass words as one token, so "the north one" names "Cimetière Nord". "Est" is also French for "is": "c'est" is cut out first. */
const COMPASS: Record<string, string> = {
  north: "nord", northern: "nord", північ: "nord", північний: "nord", північна: "nord", північне: "nord", север: "nord", северный: "nord", северная: "nord",
  south: "sud", southern: "sud", південь: "sud", південний: "sud", південна: "sud", південне: "sud", юг: "sud", южный: "sud", южная: "sud",
  east: "est", eastern: "est", схід: "est", східний: "est", східна: "est", східне: "est", восток: "est", восточный: "est", восточная: "est",
  west: "ouest", western: "ouest", захід: "ouest", західний: "ouest", західна: "ouest", західне: "ouest", запад: "ouest", западный: "ouest", западная: "ouest",
};

const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * The same word, allowing for a Ukrainian or Russian case ending: "вулиці" is "вулиця", and
 * "фунікулером" is "фунікулер". Latin words are compared as they are.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (!CYRILLIC.test(a) || !CYRILLIC.test(b) || a.length < 5 || b.length < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(4, Math.min(a.length, b.length) - 2);
}

function words(text: string): string[] {
  // "c'est", "qu'est": the verb, not the east.
  const cut = normalize(text).replace(/\b(?:c|qu|n) est\b/g, " ");
  return canonTokens(cut).map((t) => COMPASS[t] ?? t);
}

type Reading = { set: Set<number> | null; name: Set<number>; kind: Set<number> };

/**
 * The choice a short spoken answer picks, or null when it is not one of the closed forms, or fits
 * no choice or more than one. `choices` are the open question's, in the order they were asked.
 */
export function readPick(reply: string, choices: PickChoice[]): HeardPick | null {
  const n = choices.length;
  if (!n) return null;
  const raw = normalize(reply).split(" ").filter(Boolean);
  if (!raw.length || raw.length > MAX_WORDS) return null;
  if (raw.some((w, i) => (w === "second" || w === "seconds") && BEFORE_SECOND.has(raw[i - 1] ?? ""))) return null;
  const said = words(reply);
  if (!said.length) return null;

  // A filler inside a name ("міст над Володимирським узвозом") names nothing.
  const names = choices.map((c) => [...new Set(words(`${c.name} ${c.town ?? ""}`))].filter((t) => !FILLER.has(t)));
  const inName = (i: number, w: string) => names[i].some((t) => sameWord(t, w));
  /** A word in every choice's name tells none of them apart: "Château" of two Châteaux de Vincennes. */
  const shared = (w: string) => n > 1 && names.every((_, i) => inName(i, w));
  const all = new Set(choices.map((_, i) => i));
  const content = said.filter((w) => !FILLER.has(w) || ONES.has(w));
  // "Le château" names the castle by its kind. "Château de Vincennes" says the name both have:
  // two words of it or more are the name, and tell nothing.
  const sharedName = said.filter(shared).length >= 2;

  const hows = new Set<PickHow>();
  const readings: Reading[] = [];
  for (let k = 0; k < said.length; k++) {
    const w = said[k];
    const none = { name: new Set<number>(), kind: new Set<number>() };
    // A number, an ordinal, "the last one".
    const counted = ONES.has(w) ? (content.length === 1 || NUMBER_LEAD.has(said[k - 1] ?? "") ? 1 : null) : (CARDINALS[w] ?? ORDINALS[w] ?? (LAST.has(w) ? n : null));
    if (counted != null) {
      // A number that is also in a choice's name ("Rue des Deux Communes") could mean either.
      if (counted > n || choices.some((_, i) => inName(i, w))) return null;
      hows.add("number");
      readings.push({ set: new Set([counted - 1]), ...none });
      continue;
    }
    if (YES.has(w)) {
      if (n !== 1) return null;
      hows.add("yes");
      readings.push({ set: new Set([0]), ...none });
      continue;
    }
    if (NEARER.has(w) || FARTHER.has(w)) {
      const d = choices.map((c) => c.distance_m);
      if (n < 2 || d.some((x) => typeof x !== "number" || !Number.isFinite(x))) return null;
      const order = choices.map((_, i) => i).sort((a, b) => (d[a] as number) - (d[b] as number));
      if (FARTHER.has(w)) order.reverse();
      const gap = Math.abs((d[order[0]] as number) - (d[order[1]] as number));
      if (gap < NEARER_BY_M || gap < NEARER_BY_SHARE * Math.min(d[order[0]] as number, d[order[1]] as number)) return null;
      hows.add("nearest");
      readings.push({ set: new Set([order[0]]), ...none });
      continue;
    }
    if (NUMBER_LEAD.has(w)) {
      readings.push({ set: null, ...none });
      continue;
    }
    const name = new Set(shared(w) ? [] : choices.flatMap((_, i) => (inName(i, w) ? [i] : [])));
    const kind = new Set(shared(w) && sharedName ? [] : choices.flatMap((c, i) => (isCategoryWord(w, c.category) ? [i] : [])));
    if (name.size || (kind.size && kind.size < n)) {
      hows.add("name");
      readings.push({ set: null, name, kind });
      continue;
    }
    // Says nothing about which: a word of every name, the kind they all are, or a filler.
    if (shared(w) || kind.size === n || FILLER.has(w)) {
      readings.push({ set: null, ...none });
      continue;
    }
    // Any other word: not a closed form.
    return null;
  }

  const meet = (sets: Set<number>[]) => sets.reduce((acc, s) => new Set([...acc].filter((i) => s.has(i))), all);
  const telling = readings.filter((r) => r.set || r.name.size || r.kind.size);
  if (!telling.length) return null;
  // A word in one choice's name means that choice; a word in no name is read as a kind.
  let fit = meet(telling.map((r) => r.set ?? (r.name.size ? r.name : r.kind)));
  // That left nothing: a word that is in a name and is also a kind word ("лікарня") is read as either.
  if (!fit.size) fit = meet(telling.map((r) => r.set ?? new Set([...r.name, ...r.kind])));
  if (fit.size !== 1) return null;
  const how: PickHow = hows.has("name") ? "name" : hows.has("number") ? "number" : hows.has("nearest") ? "nearest" : "yes";
  return { choice: [...fit][0] + 1, how };
}
