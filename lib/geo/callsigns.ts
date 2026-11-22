/**
 * Who sent a radio report, read from its words and matched against the mission's roster [200].
 * Over the radio the sender says their call sign first ("ALPHA 1, at the château", "ALPHA 1 to
 * base") or after the station they call ("BASE, this is ALPHA 1", "Базо, я Сокіл").
 *
 * No model, and nothing here creates a unit: the answer names a roster entry, asks which one, or
 * leaves the report unassigned for the operator. A near match counts only when exactly one roster
 * entry is close. When the number is in doubt ("Alpha to base": ALPHA 2, or ALPHA 1 with its
 * number lost), the answer is to ask, never a pick: moving the wrong unit is worse than clutter.
 *
 * A call sign at the end may be a sign-off [237], as pilots give it: "At the town hall, Alpha 1,
 * over". It may also be who is spoken to ("Go ahead, Alpha 1"), so the answer is then a question
 * for the operator with that one unit to confirm, never the unit itself. Only when nothing at the
 * start named a sender, only after a written pause and with its number said, and never after a word
 * that ties it into the sentence ("I'm at the church with Bravo 2").
 * Pure, like the resolver, and safe to import on the client.
 */
import { normalize, transliterateUk } from "./normalize";

export type CallsignHow = "exact" | "near";

export type CallsignMatch =
  /** One roster entry. `heard` is the words it was read from, as speech-to-text wrote them. */
  | { kind: "unit"; callsign: string; how: CallsignHow; heard: string; why: string }
  /**
   * More than one roster entry is close, or one is and the words may name a unit not on the roster.
   * `signoff` when the call sign came at the end of the transmission [237]: then even one candidate
   * is a question, because it may be who is spoken to.
   */
  | { kind: "ask"; candidates: string[]; heard: string; why: string; signoff?: true }
  /**
   * No sender on the roster. `read` is a call sign heard that is not on it ("DELTA 4"), if any.
   * `station` is set when the command post is the one speaking ("ALPHA 1, this is BASE").
   */
  | { kind: "unassigned"; heard: string | null; read: string | null; why: string; station?: true };

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

/**
 * Words that close a transmission, after a sign-off [237]: "Alpha 1, over", "Alpha 1 out",
 * "Alpha 1, standing by", «Сокіл, прийом». Longest first.
 */
const CLOSERS: string[][] = [
  ["over", "and", "out"], ["standing", "by"], ["over"], ["out"], ["listening"],
  ["a", "vous"], ["termine"], ["parlez"],
  ["кінець", "звязку"], ["конец", "связи"], ["прийом"], ["прием"], ["приём"],
  // Whisper writes these for the silence after the last word.
  ["thank", "you"], ["thanks"], ["merci"], ["дякую"],
];
/**
 * Words that speak to someone: "Are you at the church, Bravo 2", "Say again your position, Alpha 1".
 * A call sign at the end of such a sentence is who is spoken to, not who speaks.
 */
const TO_SOMEONE = new Set(["you", "your", "yours", "tu", "toi", "ton", "ta", "ти", "тебе", "твій", "твоя", "ви", "вас", "ваш", "ты", "тебя", "вы"]);
/** Right before a call sign at the end, these say it is the sender: "…, this is Alpha 1", "…, from Alpha 1". */
const INTRO_AT_END: string[][] = [...INTRO, ["from"]];
/**
 * Words that tie a call sign at the end into the sentence, so it is not a sign-off [237]: "with
 * Bravo 2", "near Charlie 3", "I see Alpha 2", "checkpoint Charlie 3", «біля Сокола». A report that
 * ends this way names another unit, and giving it to that unit would move the wrong marker.
 */
const TIES = new Set([
  "with", "near", "see", "sees", "seeing", "saw", "at", "to", "of", "and", "behind", "towards", "toward", "by", "is", "are", "was", "for", "on", "in",
  "past", "after", "before", "between", "beside", "meet", "meeting", "met", "join", "joining", "joined", "support", "supporting", "cover", "covering",
  "follow", "following", "relieve", "relieving", "call", "calling", "called", "tell", "ask", "contact", "reach", "reached", "help", "helping",
  "or", "not", "than", "like", "about", "checkpoint", "point", "position", "objective",
  "avec", "pres", "de", "a", "vers", "et", "voit", "vois", "derriere", "devant", "chez", "pour", "sur", "rejoins", "rejoindre", "appelle",
  "з", "із", "зі", "біля", "бачу", "до", "і", "й", "та", "за", "перед", "коло", "поруч", "на", "у", "в", "для", "с", "со", "возле", "вижу", "к", "и", "около", "рядом",
]);

const CYRILLIC = /[Ѐ-ӿ]/;
const VOWELS_UK = "аеєиіїоуюяыэё";
/** Case endings, longest first. "Сокола", "Соколові" and "Соколом" are all «Сокіл». */
const UK_ENDINGS = ["ові", "еві", "ою", "ею", "єю", "ом", "ем", "єм", "ам", "ям", "ах", "ях", "ів", "їв", "ей", "у", "ю", "а", "я", "і", "ї", "и", "е", "є", "о", "ь"];

interface Tok {
  /** As written, for the words kept as heard. */
  raw: string;
  /** As compared: lower case, accents folded (normalize). */
  norm: string;
  /** A pause was written before it: a comma, a full stop, a dash. Not a hyphen ("Alpha-1"). */
  brk: boolean;
  /** A question mark comes right after it. */
  asked: boolean;
}

/** What speech-to-text writes for a pause between two words. A hyphen with spaces round it is a dash. */
const PAUSE = /[,.;:!?…—–\n]|\s-\s/;

/** The words, as written and as compared. "Alpha1" is two words, "зв'язку" one. */
function words(text: string): Tok[] {
  const out: Tok[] = [];
  const cleaned = text.replace(/(?<=[Ѐ-ӿ])['’ʼ`](?=[Ѐ-ӿ])/g, "");
  let at = 0;
  for (const m of cleaned.matchAll(/[\p{L}\p{N}]+/gu)) {
    const before = cleaned.slice(at, m.index);
    at = m.index + m[0].length;
    if (out.length && before.includes("?")) out[out.length - 1].asked = true;
    const glued = m[0].match(/^(\p{L}{2,})(\d{1,3})$/u);
    let brk = PAUSE.test(before);
    for (const part of glued ? [glued[1], glued[2]] : [m[0]]) {
      const norm = normalize(part).replace(/ /g, "");
      if (norm) out.push({ raw: part, norm, brk, asked: false });
      brk = false;
    }
  }
  if (out.length && cleaned.slice(at).includes("?")) out[out.length - 1].asked = true;
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

/** Where the report's own words end: before "over", "out" and the like. */
function beforeClosers(toks: Tok[], from: number): number {
  let end = toks.length;
  for (;;) {
    const seq = CLOSERS.find((s) => s.length <= end - from && s.every((w, k) => toks[end - s.length + k].norm === w));
    if (!seq) return end;
    end -= seq.length;
  }
}

/**
 * The sender's call sign at the end of the transmission, as a sign-off [237]: "At the town hall,
 * Alpha 1, over". Tried only when the opening words named no sender.
 *
 * The answer is a question for the operator, never a unit. Speaking to a unit looks the same as
 * signing off ("Push up to the station, Bravo 2", "Go ahead, Alpha 1"), and two rounds of held-out
 * cases showed no rule tells them apart: every one that named another unit after a pause was read
 * as that unit. So the reader says who it may be, and a person confirms it with one tap.
 *
 * A sentence can also end with another unit's call sign in more ways than a list of words can hold
 * ("linking up alongside Bravo 2", "200 metres from Alpha 2"), so even the question needs a sign
 * that the call sign stands apart. Null unless all of this holds:
 *   - it is the last thing said, but for closing words;
 *   - it names a roster entry, with its number said ("Alpha" alone may be a checkpoint);
 *   - a pause was written right before it, or before the words that say who is speaking ("…, this
 *     is Alpha 1", "…, from Alpha 1"): with no pause it is part of the sentence, and the report
 *     waits for the operator;
 *   - the word before it does not tie it into the sentence all the same ("with, Bravo 2");
 *   - it is not a question, and nothing before it speaks to someone ("Are you there, Bravo 2?");
 *   - something was said before it.
 */
function signOff(toks: Tok[], from: number, roster: Entry[]): CallsignMatch | null {
  const end = beforeClosers(toks, from);
  const said = toks.slice(0, end);
  const last = said[end - 1];
  if (!last || last.asked) return null;
  const numbered = numberOf(last.norm) != null || SOUNDS_LIKE[last.norm] != null;
  // A call sign is at most a word in two parts and two number words: look back that far.
  for (let k = Math.max(from + 1, end - 4); k < end; k++) {
    const r = readAt(said, k, roster);
    if (!r || r.end !== end) continue;
    const hits = new Map([...r.hits].filter(([c]) => numbered || roster.find((e) => e.callsign === c)?.num == null));
    if (!hits.size) continue;
    const intro = INTRO_AT_END.find((seq) => seq.length <= k - from && seq.every((w, n) => said[k - seq.length + n].norm === w));
    const apart = k - (intro?.length ?? 0);
    if (!said[apart].brk || apart <= from) return null;
    if (!intro && TIES.has(said[k - 1].norm)) return null;
    if (said.slice(from, apart).some((t) => TO_SOMEONE.has(t.norm) || t.asked)) return null;
    const m = decide(said, { ...r, hits }, roster, "at the end");
    if (m.kind === "unassigned") return null;
    const candidates = m.kind === "unit" ? [m.callsign] : m.candidates;
    return { kind: "ask", candidates, heard: m.heard, signoff: true, why: `${m.why}; a call sign at the end may be a sign-off or who is spoken to, so the operator confirms` };
  }
  return null;
}

/**
 * True when the transmission ends with the command post's own call sign, set apart by a pause:
 * "Alpha 1, move to the station and report, Base out." The command post is speaking, to the unit
 * named first. Not "Alpha 1 to Base, over": there the unit calls the command post.
 */
function stationSignsOff(toks: Tok[], from: number, stations: string[][]): boolean {
  const end = beforeClosers(toks, from);
  for (let k = Math.max(from + 1, end - 3); k < end; k++) {
    if (toks[k].brk && stationOnce(toks.slice(0, end), k, stations) === end) return true;
  }
  return false;
}

/**
 * The sender's call sign, read from the opening words of a radio report, against the roster. When
 * the opening words name no one and the report ends with a call sign, the answer is a question
 * about that unit [237]. See the file comment for the rules; docs/callsigns.md has examples and
 * the eval.
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
    // "Base, at the town hall, Alpha 1": the sender signs off instead.
    return signOff(toks, at, entries) ?? unknownNameAt(toks, at, stations) ?? { ...none, why: "the command post was called, but no sender was said" };
  }

  // The sender first: "ALPHA 1, at the château", "ALPHA 1 to base". Unless "this is" follows:
  // then the first is who is called ("BRAVO 2, this is ALPHA 1").
  const first = readAt(toks, i, entries);
  if (first) {
    const at = seqAt(toks, first.end, INTRO);
    if (at > first.end && stationAt(toks, at, stations) > at) {
      return { ...none, station: true, why: `the command post is speaking, to "${heardOf(toks, first)}"` }; // "ALPHA 1, this is BASE", "Соколе, я База"
    }
    if (at > first.end) {
      const second = readAt(toks, at, entries);
      if (second) return decide(toks, second, entries, `after "${heardOf(toks, first)}, ${heardOf(toks, { start: first.end, end: at })}"`);
    }
    if (stationSignsOff(toks, first.end, stations)) {
      return { ...none, station: true, why: `the command post signs off, speaking to "${heardOf(toks, first)}"` }; // "Alpha 1, report your position, Base out"
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
  // Nothing at the start: the call sign may come last, as a sign-off [237].
  return signOff(toks, i, entries) ?? none;
}

/** True when only closing words are left ("over", "out", «прийом»), or nothing: what may follow a sign-off. */
export function onlyClosers(text: string): boolean {
  const toks = words(text);
  return beforeClosers(toks, 0) === 0;
}

/**
 * The words before a sign-off, for the model: "At the town hall, this is" is "At the town hall".
 * The words that say who is speaking go with the call sign.
 */
export function beforeSignOff(text: string): string {
  let out = text.replace(/[^\p{L}\p{N}]+$/u, "");
  for (const seq of INTRO_AT_END) {
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${seq.join("[^\\p{L}\\p{N}]+")}$`, "iu").exec(out);
    if (m) {
      out = out.slice(0, m.index).replace(/[^\p{L}\p{N}]+$/u, "");
      break;
    }
  }
  return out;
}
