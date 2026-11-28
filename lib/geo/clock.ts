/**
 * Clock directions: "200 metres at 3 o'clock", "à 3 heures", "на 3 години", "на три часа".
 * Read from the words, here in code [198]. The intent schema has only the eight compass words, and
 * the model turned "3 o'clock" into south-east. 12 o'clock is north, as on the map: the app does
 * not know which way the speaker faces. Pure.
 */
import { tokens } from "./normalize";
import type { Direction, Intent } from "./types";

export interface ClockSaid {
  /** The hour said, from 0.5 to 12: 4.5 for "4:30". */
  hour: number;
  /** The bearing, degrees: 12 o'clock is 0 (north), 3 o'clock is 90 (east). */
  deg: number;
  /** Which wording produced it: a clock hour, degrees or mils. */
  source?: "clock" | "degrees" | "mils";
  /** The nearest of the eight compass points. 1 and 2 o'clock are both north-east. */
  direction: Direction;
}

const POINTS: Direction[] = ["north", "north_east", "east", "south_east", "south", "south_west", "west", "north_west"];

const HOURS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, midi: 12,
  // Ukrainian and Russian cardinals; the apostrophe in п'ять and дев'ять is folded away.
  одну: 1, одна: 1, один: 1, дві: 2, два: 2, три: 3, чотири: 4, четыре: 4, пять: 5, шість: 6, шесть: 6, сім: 7, семь: 7,
  вісім: 8, восемь: 8, девять: 9, десять: 10, одинадцять: 11, одиннадцать: 11, дванадцять: 12, двенадцать: 12,
};
/** Ukrainian ordinals, any ending: "на третю годину", "на дев'яту годину". */
const ORDINAL_STEMS: [string, number][] = [
  ["одинадцят", 11], ["дванадцят", 12], ["перш", 1], ["друг", 2], ["трет", 3], ["четверт", 4], ["пят", 5], ["шост", 6],
  ["сьом", 7], ["восьм", 8], ["девят", 9], ["десят", 10],
];
const HOUR_WORDS_RU = new Set(["час", "часа", "часов"]);

function hourOf(t: string | undefined): number | null {
  if (t == null) return null;
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n : null;
  }
  return HOURS[t] ?? ORDINAL_STEMS.find(([s]) => t.startsWith(s))?.[1] ?? null;
}

function said(hour: number): ClockSaid {
  const deg = ((hour % 12) * 30) % 360;
  return { hour, deg, source: "clock", direction: POINTS[Math.round(deg / 45) % 8] };
}

/**
 * Every clock direction in the words, in order. A number alone is not one ("at 3"), and the
 * French and Ukrainian ones need "à" or "на" in front: "3 heures" and "3 години" alone are hours.
 */
export function clocksSaid(transcript: string): ClockSaid[] {
  const toks = tokens(transcript);
  const out: ClockSaid[] = [];
  for (const [i, t] of toks.entries()) {
    // "3 o'clock", "three o'clock", "3 oclock", "4:30 o'clock"
    if (t === "oclock" || (t === "o" && toks[i + 1] === "clock")) {
      const half = toks[i - 1] === "30" ? 1 : 0;
      const h = hourOf(toks[i - 1 - half]);
      if (h != null) out.push(said(h + half / 2));
      continue;
    }
    // "à 3h", "à 4h30"
    const fr = /^(\d{1,2})h(00|30)?$/.exec(t);
    if (fr && toks[i - 1] === "a") {
      const h = hourOf(fr[1]);
      if (h != null) out.push(said(h + (fr[2] === "30" ? 0.5 : 0)));
      continue;
    }
    // "à 3 heures", "à trois heures", "à midi"
    if (t === "midi" && toks[i - 1] === "a") {
      out.push(said(12));
      continue;
    }
    const hourWord = t === "heure" || t === "heures" ? "a" : t.startsWith("годин") || HOUR_WORDS_RU.has(t) ? "на" : null;
    if (hourWord && toks[i - 2] === hourWord) {
      const h = hourOf(toks[i - 1]);
      if (h != null) out.push(said(h));
    }
  }
  return out;
}

/** The one clock direction said, or null when none was said or two different ones were. */
export function clockSaid(transcript: string): ClockSaid | null {
  const all = clocksSaid(transcript);
  return all.length && all.every((c) => c.hour === all[0].hour) ? all[0] : null;
}

/**
 * The model's compass reading, checked against a clock direction said. The clock wins: it goes
 * where the model put a compass way, the relation ("east_of") if it used one, else the direction
 * of travel. Two different clock directions are not a reading: the way is left out, and the app asks.
 */
export function clockChecked(intent: Intent, transcript: string): Intent {
  const all = clocksSaid(transcript);
  // A bearing in degrees or mils is read the same way, when no clock was said [229].
  const bearing = all.length ? null : bearingSaid(transcript);
  if (!all.length && !bearing) return intent;
  const one = bearing ?? clockSaid(transcript);
  if (intent.relation && /_of$/.test(intent.relation)) {
    return { ...intent, relation: one ? (`${one.direction}_of` as Intent["relation"]) : null, direction: null };
  }
  return { ...intent, direction: one?.direction ?? null };
}

// ---------- Which way the speaker faces [224] ----------
// Above, 12 o'clock is north, as on the map [198]. When the speaker says which way they face,
// 12 o'clock is that way instead: "facing east, 300 metres at my 3 o'clock" is south.

const FACING_WORDS = new Set(["facing", "face", "faces", "oriente", "orientee", "orientes", "обличчям", "лицем", "дивлюсь", "дивлюся", "дивимось", "смотрю"]);
const FACING_FILLER = new Set(["the", "to", "a", "au", "l", "le", "la", "vers", "на", "в"]);
const POINT_DEG: Record<string, number> = { north: 0, east: 90, south: 180, west: 270, northeast: 45, southeast: 135, southwest: 225, northwest: 315, nord: 0, est: 90, sud: 180, ouest: 270 };
const UK_POINTS: [string, number][] = [["північ", 0], ["півн", 0], ["схід", 90], ["схо", 90], ["півден", 180], ["захід", 270], ["захо", 270], ["север", 0], ["восток", 90], ["юг", 180], ["запад", 270]];
const pointOf = (t: string | undefined): number | null => (t == null ? null : POINT_DEG[t] ?? UK_POINTS.find(([s]) => t.startsWith(s))?.[1] ?? null);

/** Lower case, Latin accents dropped, apostrophes inside Cyrillic words joined, punctuation out. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[À-ɏ]/g, (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .replace(/([Ѐ-ӿ])[’ʼ'`]([Ѐ-ӿ])/g, "$1$2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Which way the speaker said they face, degrees from north: "facing north", "face au nord-est", "дивлюсь на схід". */
export function facingSaid(transcript: string): number | null {
  const toks = words(transcript);
  for (let i = 0; i < toks.length; i++) {
    if (!FACING_WORDS.has(toks[i])) continue;
    let j = i + 1;
    while (j < toks.length && FACING_FILLER.has(toks[j])) j++;
    const a = pointOf(toks[j]);
    if (a == null) continue;
    const b = pointOf(toks[j + 1]);
    if (b != null && (a === 0 || a === 180) && (b === 90 || b === 270)) return a === 0 && b === 270 ? 315 : (a + b) / 2;
    return a;
  }
  return null;
}

/** "two klicks": kilometres, which the model may read as 2 m. Null when no klick was said. */
export function klicksSaid(transcript: string): number | null {
  const toks = words(transcript);
  for (let i = 0; i < toks.length - 1; i++) {
    const n = /^\d{1,3}$/.test(toks[i]) ? Number(toks[i]) : HOURS[toks[i]] ?? null;
    if (n && ["klick", "klicks", "klik", "kliks"].includes(toks[i + 1])) return n * 1000;
  }
  return null;
}

/** A clock direction turned so that 12 o'clock is `facing` degrees, not north. */
export function turnClock(c: ClockSaid, facing: number): ClockSaid {
  const deg = Math.round((((c.deg + facing) % 360) + 360) % 360);
  return { hour: c.hour, deg, direction: POINTS[Math.round(deg / 45) % 8] };
}

export interface Faced {
  intent: Intent;
  /** The clock direction, turned when the facing is known; null when none was said. */
  clock: ClockSaid | null;
  /** Degrees, or null when the words did not say. */
  facing: number | null;
}

/**
 * The intent with its compass way turned to where the speaker said they face, when a clock
 * direction was said too. The way the model or `clockChecked` put north-based is moved.
 */
export function withFacing(intent: Intent, transcript: string): Faced {
  const clock = clockSaid(transcript);
  const facing = facingSaid(transcript);
  // A bearing is already from north: it is the angle, and no facing turns it [229].
  if (!clock) return { intent, clock: bearingSaid(transcript), facing };
  if (facing == null) return { intent, clock, facing };
  const turned = turnClock(clock, facing);
  const relation = intent.relation === `${clock.direction}_of` ? (`${turned.direction}_of` as Intent["relation"]) : intent.relation;
  const direction = intent.direction === clock.direction ? turned.direction : intent.direction;
  return { intent: { ...intent, relation, direction }, clock: turned, facing };
}

// ---------- Bearings in degrees or mils [229] ----------
// "Contact, bearing 060, 300 metres", "azimut 120", "азимут 45", "1600 mils": the way from the
// speaker as an angle from north, as a compass or a map gives it. Not turned by a facing: a
// bearing is already from north. The eight compass words would round 060 to north-east, 15° off.

const BEARING_WORDS = new Set(["bearing", "bearings", "azimuth", "azimut", "azimuts", "азимут", "азимуті", "азимутом", "азимута", "пеленг", "пеленгом"]);
const MILS_WORDS = new Set(["mil", "mils", "millieme", "milliemes", "mills"]);
const DEGREE_WORDS = new Set(["degree", "degrees", "deg", "degre", "degres", "градус", "градуси", "градусів", "градусов", "градуса"]);
const SPOKEN_DIGIT: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", niner: "9",
  un: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", sept: "7", huit: "8", neuf: "9",
  нуль: "0", один: "1", два: "2", три: "3", чотири: "4", пять: "5", шість: "6", сім: "7", вісім: "8", девять: "9",
};

/**
 * The number that starts at `i`: "060", "0 6 0", or "zero six zero" said digit by digit, as on a
 * radio. Returns the number and where it ends.
 */
function numberAt(toks: string[], i: number): { n: number; end: number; spoken: string } | null {
  if (/^\d{1,4}$/.test(toks[i] ?? "") && toks[i].length > 1) return { n: Number(toks[i]), end: i + 1, spoken: "" };
  let digits = "";
  let j = i;
  while (j < toks.length && digits.length < 4) {
    const d = /^\d$/.test(toks[j]) ? toks[j] : SPOKEN_DIGIT[toks[j]];
    if (d === undefined) break;
    digits += d;
    j++;
  }
  return digits ? { n: Number(digits), end: j, spoken: digits } : null;
}

const asSaid = (deg: number, source: "degrees" | "mils"): ClockSaid => {
  const d = Math.round(((deg % 360) + 360) % 360);
  return { hour: d / 30, deg: d, source, direction: POINTS[Math.round(d / 45) % 8] };
};

/** A bearing said, from north: "bearing 060", "azimut 120 degrés", "1600 mils". Null when none was. */
export function bearingSaid(transcript: string): ClockSaid | null {
  const toks = words(transcript);
  for (let i = 0; i < toks.length; i++) {
    const after = BEARING_WORDS.has(toks[i]);
    const at = after ? i + 1 : i;
    let num = numberAt(toks, at);
    if (!num) continue;
    // One spoken digit is not a bearing: "bearing zero sixty" would read as 0°. Better none.
    if (num.spoken.length === 1) continue;
    // Said digit by digit, a bearing has three: "zero six zero, three hundred metres" is 060.
    if (num.spoken.length === 4 && !MILS_WORDS.has(toks[num.end] ?? "")) num = { n: Number(num.spoken.slice(0, 3)), end: num.end - 1, spoken: num.spoken.slice(0, 3) };
    const unit = toks[num.end];
    if (unit && MILS_WORDS.has(unit)) {
      if (num.n <= 6400) return asSaid((num.n * 360) / 6400, "mils");
      continue;
    }
    if (after && num.n <= 360) return asSaid(num.n, "degrees");
    if (!after && unit && DEGREE_WORDS.has(unit) && num.n <= 360 && (BEARING_WORDS.has(toks[i - 1] ?? "") || toks[i - 1] === "at")) return asSaid(num.n, "degrees");
  }
  return null;
}
