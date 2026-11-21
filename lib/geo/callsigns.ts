/**
 * Who sent a radio report, read from its words and matched against the mission's roster [199].
 * Over the radio the sender says their call sign first ("ALPHA 1, at the château", "ALPHA 1 to
 * base") or after the station they call ("BASE, this is ALPHA 1", "Базо, я Сокіл").
 *
 * No model, and nothing here creates a unit: the answer names a roster entry, asks which one, or
 * leaves the report unassigned for the operator. A near match counts only when exactly one roster
 * entry is close. When the number is in doubt ("Alpha to base": ALPHA 2, or ALPHA 1 with its
 * number lost), the answer is to ask, never a pick: moving the wrong unit is worse than clutter.
 * Pure, like the resolver, and safe to import on the client.
 */
import { normalize, transliterateUk } from "./normalize";

export type CallsignHow = "exact" | "near";

export type CallsignMatch =
  /** One roster entry. `heard` is the words it was read from, as speech-to-text wrote them. */
  | { kind: "unit"; callsign: string; how: CallsignHow; heard: string; why: string }
  /** More than one roster entry is close, or one is and the words may name a unit not on the roster. */
  | { kind: "ask"; candidates: string[]; heard: string; why: string }
  /** No sender on the roster. `read` is a call sign heard that is not on it ("DELTA 4"), if any. */
  | { kind: "unassigned"; heard: string | null; read: string | null; why: string };

export interface CallsignOptions {
  /** The command post's own call signs: who is being called, never the sender. Default `STATION_CALLSIGNS`. */
  station?: string[];
}

export const STATION_CALLSIGNS = ["BASE", "CONTROL", "ZERO", "HQ", "COMMAND POST", "COMMAND", "PC", "POSTE DE COMMANDEMENT", "БАЗА", "ШТАБ"];

/** The NATO spelling alphabet, with the other spellings speech-to-text writes, Cyrillic ones included. */
const NATO: Record<string, string[]> = {
  alpha: ["alfa", "альфа"],
  bravo: ["браво"],
  charlie: ["чарлі", "чарли"],
  delta: ["дельта"],
  echo: ["ехо", "еко", "эхо"],
  foxtrot: ["фокстрот"],
  golf: ["гольф"],
  hotel: ["готель", "хотел"],
  india: ["індія", "индия"],
  juliett: ["juliet", "джульєтта", "джульетта"],
  kilo: ["кіло", "кило"],
  lima: ["ліма", "лима"],
  mike: ["майк"],
  november: ["новембер"],
  oscar: ["оскар"],
  papa: ["папа"],
  quebec: ["квебек"],
  romeo: ["ромео"],
  sierra: ["сієрра", "сьєрра", "сиерра"],
  tango: ["танго"],
  uniform: ["юніформ"],
  victor: ["віктор", "виктор"],
  whiskey: ["whisky", "віскі", "виски"],
  xray: ["іксрей", "иксрей"],
  yankee: ["янкі", "янки"],
  zulu: ["зулу"],
};

/** Numbers said one way only. NATO's own "niner", "fower", "fife", "wun" and "ait" are here too. */
const NUMBER: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  niner: 9, fower: 4, fife: 5, wun: 1, ait: 8,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  нуль: 0, один: 1, одна: 1, одне: 1, два: 2, дві: 2, три: 3, чотири: 4, пять: 5, шість: 6, сім: 7, вісім: 8, девять: 9, десять: 10,
  четыре: 4, шесть: 6, семь: 7, восемь: 8,
};
/** English words that sound like a number. A near reading: speech-to-text writes "Alpha won", "Charlie tree". */
const SOUNDS_LIKE: Record<string, number> = { won: 1, to: 2, too: 2, tree: 3, free: 3, for: 4, fore: 4, ate: 8 };
/** Of those, the ones that are often just the word: "ALPHA 1 to base", "Bravo for base". Read both ways. */
const ALSO_A_WORD = new Set(["to", "for"]);

/** Words before the call sign that say nothing: "Uh, ALPHA 1", "Hello BASE". */
const FILLER = new Set([
  "uh", "um", "er", "erm", "ah", "euh", "hum", "hmm", "ok", "okay", "so", "well", "hello", "hi", "hey", "yes", "yeah", "roger", "copy",
  "allo", "alors", "bon", "oui", "ну", "алло", "е", "ем", "так",
]);
/**
 * Words that put the sender next: "this is ALPHA 1", "ici ALPHA 1", "це Сокіл", "тут Сокіл",
 * "я Сокіл", "від Сокола", "на зв'язку Сокіл", "доповідає Грім".
 */
const INTRO: string[][] = [["this", "is"], ["ici"], ["c", "est"], ["це"], ["тут"], ["я"], ["від"], ["на", "звязку"], ["доповідає"], ["это"], ["от"]];
/** Right after the station's call sign, two more: "BASE from ALPHA 1", "PC de Charlie 3". */
const INTRO_AFTER_STATION: string[][] = [...INTRO, ["from"], ["de"]];
/** "this is ALPHA 1" counts within the first words only; later, a call sign is who the report is about. */
const OPENING = 8;

const CYRILLIC = /[Ѐ-ӿ]/;
const VOWELS_UK = "аеєиіїоуюяыэё";
/** Case endings, longest first. "Сокола", "Соколові" and "Соколом" are all «Сокіл». */
const UK_ENDINGS = ["ові", "еві", "ою", "ею", "єю", "ом", "ем", "єм", "ам", "ям", "ах", "ях", "ів", "їв", "ей", "у", "ю", "а", "я", "і", "ї", "и", "е", "є", "о", "ь"];

interface Tok {
  /** As written, for the words kept as heard. */
  raw: string;
  /** As compared: lower case, accents folded (normalize). */
  norm: string;
}

/** The words, as written and as compared. "Alpha1" is two words, "зв'язку" one. */
function words(text: string): Tok[] {
  const out: Tok[] = [];
  const cleaned = text.replace(/(?<=[Ѐ-ӿ])['’ʼ`](?=[Ѐ-ӿ])/g, "");
  for (const raw of cleaned.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const glued = raw.match(/^(\p{L}{2,})(\d{1,3})$/u);
    for (const part of glued ? [glued[1], glued[2]] : [raw]) {
      const norm = normalize(part).replace(/ /g, "");
      if (norm) out.push({ raw: part, norm });
    }
  }
  return out;
}

/** A Ukrainian word without its case ending, when at least three letters are left. */
function ukStem(w: string): string {
  for (const e of UK_ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
  return w;
}

/**
 * The stems of a Ukrainian word in any case. Besides the ending, the last syllable may change:
 * «Сокіл» is «Сокола» (і to о), «Орел» is «Орла» (the е drops).
 */
function ukForms(nominative: string): Set<string> {
  const stem = ukStem(nominative);
  const forms = new Set([stem, nominative]);
  const closed = stem.match(new RegExp(`^(.*)і([^${VOWELS_UK}]+)$`));
  if (closed) {
    forms.add(`${closed[1]}о${closed[2]}`);
    forms.add(`${closed[1]}е${closed[2]}`);
  }
  const fleeting = stem.match(new RegExp(`^(.*[^${VOWELS_UK}])[ое]([^${VOWELS_UK}])$`));
  if (fleeting) forms.add(fleeting[1] + fleeting[2]);
  return forms;
}

const NATO_WORD = new Map<string, string>();
const NATO_STEM = new Map<string, string>();
for (const [canon, others] of Object.entries(NATO)) {
  NATO_WORD.set(canon, canon);
  for (const o of others) {
    const w = normalize(o).replace(/ /g, "");
    NATO_WORD.set(w, canon);
    if (CYRILLIC.test(w)) NATO_STEM.set(ukStem(w), canon);
  }
}

/** The NATO word a heard word is, in any of its spellings or Ukrainian cases ("Альфи"). Null if none. */
function natoOf(w: string): string | null {
  return NATO_WORD.get(w) ?? (CYRILLIC.test(w) ? NATO_STEM.get(ukStem(w)) ?? null : null);
}

const RU_LATIN: Record<string, string> = { ы: "y", э: "e", ё: "io", ъ: "" };

/**
 * A rough key for how a word sounds, in Latin letters: "Charly" and "Charlie", "Сокил" and
 * "Sokil", "Grim" and «Грім» get one key. Only for near matches.
 */
function soundKey(w: string): string {
  let s = CYRILLIC.test(w) ? (transliterateUk(w) ?? w) : w;
  s = s.toLowerCase().replace(/[ыэёъ]/g, (c) => RU_LATIN[c]);
  s = s
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/kh/g, "h")
    .replace(/ch/g, "sh")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/c/g, "k")
    .replace(/w/g, "v")
    .replace(/g/g, "h")
    .replace(/y/g, "i")
    .replace(/ie|ee|ii/g, "i")
    .replace(/oo|ou/g, "u")
    .replace(/(.)\1+/g, "$1");
  return s.length > 3 ? s.replace(/e$/, "") : s;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}

/** Close in sound: one letter off from four letters up, two from seven. Short words must sound the same. */
function soundsClose(heard: string, word: string): boolean {
  const h = soundKey(heard);
  const w = soundKey(word);
  if (h.length < 3) return false;
  return levenshtein(h, w) <= (w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0);
}

interface Entry {
  callsign: string;
  /** The word part, compared: "alpha" (a NATO word, canonical), "сокіл". */
  word: string;
  nato: boolean;
  /** The number, as digits; null for a call sign without one («Сокіл»). */
  num: string | null;
  forms: Set<string> | null;
}

function numberOf(t: string | undefined): number | null {
  if (t == null) return null;
  if (/^\d{1,3}$/.test(t)) return Number(t);
  return NUMBER[t] ?? null;
}

function entryOf(callsign: string): Entry {
  const toks = words(callsign).map((t) => t.norm);
  let k = toks.length;
  while (k > 0 && numberOf(toks[k - 1]) != null) k--;
  const word = toks.slice(0, k).join("");
  const num = k < toks.length ? toks.slice(k).map((t) => String(numberOf(t))).join("") : null;
  const nato = natoOf(word);
  return { callsign: callsign.trim(), word: nato ?? word, nato: nato != null, num, forms: CYRILLIC.test(word) && !nato ? ukForms(word) : null };
}

/** How a heard word matches a roster entry's word, if at all. A NATO word never comes close to another one. */
function wordHow(heard: string, heardNato: string | null, e: Entry): CallsignHow | null {
  if (heardNato) return e.nato && heardNato === e.word ? "exact" : null;
  if (e.nato) return soundsClose(heard, e.word) ? "near" : null;
  if (heard === e.word || (e.forms && CYRILLIC.test(heard) && e.forms.has(ukStem(heard)))) return "exact";
  return soundsClose(heard, e.word) ? "near" : null;
}

interface NumberReading {
  num: string | null;
  how: CallsignHow | "missing";
  end: number;
  /** Two digits said one by one ("one two"): it counts only if it names a roster entry. */
  joined?: boolean;
}

/** The ways to read the words after a call sign's word as its number. */
function numbersAt(toks: Tok[], j: number): NumberReading[] {
  const t = toks[j]?.norm;
  const n = numberOf(t);
  if (n != null) {
    const out: NumberReading[] = [{ num: String(n), how: "exact", end: j + 1 }];
    const next = numberOf(toks[j + 1]?.norm);
    if (n < 10 && next != null && next < 10) out.push({ num: String(Number(`${n}${next}`)), how: "exact", end: j + 2, joined: true });
    return out;
  }
  if (t != null && SOUNDS_LIKE[t] != null) {
    const out: NumberReading[] = [{ num: String(SOUNDS_LIKE[t]), how: "near", end: j + 1 }];
    if (ALSO_A_WORD.has(t)) out.push({ num: null, how: "missing", end: j });
    return out;
  }
  return [{ num: null, how: "missing", end: j }];
}

/** How a reading's word and number match an entry. The word or the number may be a guess, not both. */
function combine(word: CallsignHow, n: NumberReading, e: Entry): CallsignHow | null {
  if (e.num == null) return word; // «Сокіл»: a number after it is the report ("Сокіл, два кілометри...")
  if (n.how === "exact") return n.num === e.num ? word : null;
  if (word !== "exact") return null;
  if (n.how === "near") return n.num === e.num ? "near" : null;
  return "near"; // the number was not heard
}

interface Read {
  hits: Map<string, CallsignHow>;
  /** Call signs the words may name that are not on the roster: "CHARLIE 2" for "Charlie to base". */
  unknown: string[];
  start: number;
  end: number;
}

/** Every roster entry the words at `i` may name, and call signs not on the roster. Null if nothing there is a call sign. */
function readAt(toks: Tok[], i: number, roster: Entry[]): Read | null {
  const hits = new Map<string, CallsignHow>();
  const unknown = new Set<string>();
  let end = i;
  for (const span of [1, 2]) {
    if (i + span > toks.length) break;
    const heard = toks.slice(i, i + span).map((t) => t.norm).join("");
    if (/^\d/.test(heard)) break;
    const nato = natoOf(heard);
    const close = roster.flatMap((e) => {
      const how = wordHow(heard, nato, e);
      return how ? [{ e, how }] : [];
    });
    // Two words count as one only when they make one call sign word: "fox trot", "x ray".
    if (span === 2 && !nato && !close.some((c) => c.how === "exact")) continue;
    if (!nato && !close.length) continue;
    for (const n of numbersAt(toks, i + span)) {
      let named = false;
      for (const { e, how } of close) {
        const h = combine(how, n, e);
        if (!h) continue;
        named = true;
        if (hits.get(e.callsign) !== "exact") hits.set(e.callsign, h);
        end = Math.max(end, e.num == null ? i + span : n.end);
      }
      // A NATO word with a number is a call sign even off the roster ("DELTA 4"); without one it is
      // a word ("Golf course", "Hôtel de ville", "Victor Hugo").
      if (!named && nato && n.num != null && !n.joined) {
        unknown.add(`${nato.toUpperCase()} ${n.num}`);
        end = Math.max(end, n.end);
      }
    }
  }
  return hits.size || unknown.size ? { hits, unknown: [...unknown], start: i, end } : null;
}

const heardOf = (toks: Tok[], r: { start: number; end: number }) => toks.slice(r.start, r.end).map((t) => t.raw).join(" ");

function decide(toks: Tok[], r: Read, roster: Entry[], how: string): CallsignMatch {
  const heard = heardOf(toks, r);
  const exact = [...r.hits].filter(([, h]) => h === "exact").map(([c]) => c);
  if (exact.length === 1) return { kind: "unit", callsign: exact[0], how: "exact", heard, why: `"${heard}" ${how} is ${exact[0]}` };
  const candidates = roster.map((e) => e.callsign).filter((c) => r.hits.has(c));
  if (candidates.length === 1 && !r.unknown.length) {
    return { kind: "unit", callsign: candidates[0], how: "near", heard, why: `"${heard}" ${how} is close to ${candidates[0]} only` };
  }
  if (candidates.length) {
    const also = r.unknown.length ? `, or ${r.unknown.join(" or ")}, who is not on the roster` : "";
    return { kind: "ask", candidates, heard, why: `"${heard}" ${how} may be ${candidates.join(" or ")}${also}` };
  }
  return { kind: "unassigned", heard, read: r.unknown[0], why: `"${heard}" ${how} is ${r.unknown.join(" or ")}, not on the roster` };
}

function seqAt(toks: Tok[], i: number, seqs: string[][]): number {
  for (const seq of seqs) if (seq.every((w, k) => toks[i + k]?.norm === w)) return i + seq.length;
  return i;
}

function skipFillers(toks: Tok[], i: number): number {
  while (i < toks.length && FILLER.has(toks[i].norm)) i++;
  return i;
}

/** The end of the station's call sign at `i` ("BASE", "command post", «Базо», «Базі»), or `i` if it is not there. */
function stationAt(toks: Tok[], i: number, stations: string[][]): number {
  const once = stationOnce(toks, i, stations);
  return once > i ? stationAt(toks, skipFillers(toks, once), stations) : i; // "Base, base, this is ALPHA 1"
}

function stationOnce(toks: Tok[], i: number, stations: string[][]): number {
  for (const s of stations) {
    if (s.every((w, k) => toks[i + k]?.norm === w)) return i + s.length;
    const t = toks[i]?.norm;
    if (s.length === 1 && t && CYRILLIC.test(s[0]) && ukForms(s[0]).has(ukStem(t))) return i + 1;
  }
  return i;
}

/**
 * A word after "this is", "тут" or "я" that is written with a capital and names no one on the
 * roster: an unknown personal call sign («Я Беркут»). Not a match, only what was heard.
 */
function unknownNameAt(toks: Tok[], i: number, stations: string[][]): CallsignMatch | null {
  const t = toks[i];
  if (!t || !/^\p{Lu}\p{L}{2,}$/u.test(t.raw) || stationAt(toks, i, stations) > i) return null;
  return { kind: "unassigned", heard: t.raw, read: t.raw.toUpperCase(), why: `"${t.raw}" is a call sign not on the roster` };
}

/**
 * The sender's call sign, read from the opening words of a radio report, against the roster.
 * See the file comment for the rules; docs/callsigns.md has examples and the eval.
 */
export function matchCallsign(transcript: string, roster: string[], opts: CallsignOptions = {}): CallsignMatch {
  const toks = words(transcript);
  const entries = roster.filter((c) => c.trim()).map(entryOf);
  const stations = (opts.station ?? STATION_CALLSIGNS).map((s) => words(s).map((t) => t.norm)).filter((s) => s.length);
  const none: CallsignMatch = { kind: "unassigned", heard: null, read: null, why: "no call sign at the start of the report" };
  const i = skipFillers(toks, 0);

  // The command post first: "BASE, this is ALPHA 1", "Базо, я Сокіл", "PC de Charlie 3".
  const st = stationAt(toks, i, stations);
  if (st > i) {
    const at = seqAt(toks, skipFillers(toks, st), INTRO_AFTER_STATION);
    const r = readAt(toks, at, entries);
    if (r) return decide(toks, r, entries, "after the command post's call sign");
    return unknownNameAt(toks, at, stations) ?? { ...none, why: "the command post was called, but no sender was said" };
  }

  // The sender first: "ALPHA 1, at the château", "ALPHA 1 to base". Unless "this is" follows:
  // then the first is who is called ("BRAVO 2, this is ALPHA 1").
  const first = readAt(toks, i, entries);
  if (first) {
    const at = seqAt(toks, first.end, INTRO);
    if (at > first.end && stationAt(toks, at, stations) > at) {
      return { ...none, why: `the command post is speaking, to "${heardOf(toks, first)}"` }; // "ALPHA 1, this is BASE", "Соколе, я База"
    }
    if (at > first.end) {
      const second = readAt(toks, at, entries);
      if (second) return decide(toks, second, entries, `after "${heardOf(toks, first)}, ${heardOf(toks, { start: first.end, end: at })}"`);
    }
    return decide(toks, first, entries, "at the start");
  }

  // "Hello all stations, this is ALPHA 1", "Тут Сокіл", "Від Сокола": within the first words only.
  for (let k = i; k < Math.min(toks.length, i + OPENING); k++) {
    const at = seqAt(toks, k, INTRO);
    if (at === k) continue;
    const r = readAt(toks, at, entries);
    if (r) return decide(toks, r, entries, `after "${heardOf(toks, { start: k, end: at })}"`);
    const name = unknownNameAt(toks, at, stations);
    if (name) return name;
  }
  return none;
}
