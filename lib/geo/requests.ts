/**
 * A request for recon, read from the words in code [234]: "send the drone", "request eyes on",
 * "envoyez le drone", "потрібна розвідка". A unit asks in the same radio call as a report
 * ("unknown vehicle at Mairie de Vincennes, send the drone") or on its own ("Track 2, request
 * eyes on"). The command post decides whether anything is sent; this only reads that it was asked.
 *
 * The request clause is cut out before the model and the other word readers see the text. Left in,
 * "send the drone" made "unknown vehicle" an unknown drone (`kindSaid` meets "drone" first), and
 * "Track 2, request eyes on" got "Where is it?". The model never sees a request, so the extraction
 * prompt is unchanged. Pure, and safe on the client.
 */
import { fold, trackNameWord, trackNumberSaid } from "./tracks";

const CYRILLIC = /[\u0400-\u04ff]/;

/** One word in a phrase: whole words for Latin text, stems for Cyrillic, which inflects. */
interface Slot {
  words?: string[];
  stems?: string[];
  optional?: boolean;
}

const w = (...words: string[]): Slot => ({ words });
const opt = (slot: Slot): Slot => ({ ...slot, optional: true });
const st = (...stems: string[]): Slot => ({ stems });

// English.
const SEND = w("send", "sending", "launch");
const ASK = w("request", "requesting", "requests", "requested", "need", "needs", "want", "require", "requires");
const DET = opt(w("the", "a", "an", "our", "another", "one", "some"));
const DRONE = w("drone", "drones", "bird", "birds", "uav", "uas", "quad", "quadcopter");
const RECON = w("drone", "drones", "bird", "uav", "uas", "recon", "reconnaissance", "overwatch", "isr");
// French, with accents dropped: "envoyé" is "envoye".
const ENVOYER = w("envoyez", "envoyer", "envoie", "envoies", "envoye", "envoyes", "envoyons", "lancez", "lancer");
const DET_FR = opt(w("le", "un", "une", "notre", "nos", "les", "des", "du"));
const DRONE_FR = w("drone", "drones");
const RECO_FR = w("reco", "reconnaissance", "drone", "drones");
// Ukrainian and Russian stems.
const SEND_UK = st("надішл", "надісл", "відправ", "запуст", "піднім", "підійм", "пришл", "отправ", "подним", "запуск", "дайт");
const NEED_UK = st("потріб", "треба", "нуж", "прош");
const DET_UK = opt(st("наш", "сво"));
const DRONE_UK = st("дрон", "пташ", "птах", "птич", "бпла", "коптер", "мавік", "мавик");
const RECON_UK = st("дрон", "пташ", "птах", "птич", "бпла", "коптер", "мавік", "мавик", "розвід", "развед", "аеророзвід");

/** The phrases that ask for recon. "Drone up" alone is not one ("enemy drone up north"), nor "getting eyes on", a reply. */
const PHRASES: Slot[][] = [
  [SEND, DET, DRONE],
  [ASK, DET, RECON],
  [ASK, w("eyes"), w("on")],
  [w("get", "put"), DET, DRONE, w("up")],
  [w("can", "could"), w("we", "you", "i"), w("get", "have"), DET, w("drone", "drones", "eyes", "recon", "bird", "uav", "overwatch")],
  [w("drone", "drones", "recon", "reconnaissance", "overwatch", "isr"), w("requested", "needed", "required")],
  [ENVOYER, DET_FR, DRONE_FR],
  [w("demande", "demandons", "demander", "demandez", "demandes"), opt(w("de", "d", "une", "un")), RECO_FR],
  [w("besoin"), opt(w("d", "de", "du")), opt(w("un", "une")), RECO_FR],
  [w("faites", "faire"), w("decoller", "monter"), DET_FR, DRONE_FR],
  [SEND_UK, DET_UK, DRONE_UK],
  [NEED_UK, DET_UK, RECON_UK],
  [st("запит", "запрос"), opt(w("на")), RECON_UK],
];

/** A word just before the phrase that turns it down: "don't send", "pas besoin", "не потрібен". */
const NOT_BEFORE = new Set(["not", "never", "dont", "no", "pas", "ne", "n", "jamais", "sans", "without", "не", "ні", "нет", "без"]);
/** "Don't", "doesn't" and "didn't" come out of the folding as two words: "don t". */
const NOT_PAIRS = new Set(["don t", "do not", "doesn t", "does not", "didn t", "did not", "won t", "will not"]);
/**
 * Words just before the request that belong to it and go with the cut: a joiner ("at the station
 * and send the drone") or who is asking ("we need", "on a besoin", "нам потрібна").
 */
const LEAD_IN = new Set([
  "and", "also", "then", "please", "we", "i", "us", "so",
  "et", "puis", "aussi", "on", "a", "nous", "avons", "j", "ai", "il", "faut",
  "і", "й", "та", "и", "також", "нам", "мені", "мне", "я", "ми", "мы",
]);
/** Radio words that say nothing on their own: a request with only these left is a request on its own. */
const FILLER = new Set([
  "over", "out", "roger", "copy", "please", "now", "asap", "urgent", "urgently", "immediately", "there", "it", "on", "at", "to", "for",
  "termine", "svp", "merci", "sur", "vers", "maintenant", "vite",
  "прийом", "кінець", "приём", "прием", "конец", "терміново", "срочно", "на", "до",
]);

interface Token {
  /** As folded: lower case, Latin accents dropped. */
  norm: string;
  start: number;
  end: number;
}

/** Words with where they stand in the text, so a clause can be cut out of what was said. */
function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/[\u0400-\u04ff]+(?:[\u2019\u02bc'`][\u0400-\u04ff]+)*|[\p{L}\p{N}]+/gu)) {
    const norm = fold(m[0]);
    if (norm) out.push({ norm, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

function fits(slot: Slot, t: Token | undefined): boolean {
  if (!t) return false;
  if (slot.words?.includes(t.norm)) return true;
  return CYRILLIC.test(t.norm) && (slot.stems ?? []).some((s) => t.norm.startsWith(s));
}

/** The index after the last word of the phrase when it starts at word i, or -1. */
function matchAt(phrase: Slot[], toks: Token[], i: number, k = 0): number {
  if (k === phrase.length) return i;
  const slot = phrase[k];
  if (fits(slot, toks[i])) {
    const end = matchAt(phrase, toks, i + 1, k + 1);
    if (end >= 0) return end;
  }
  return slot.optional ? matchAt(phrase, toks, i, k + 1) : -1;
}

/** No clause mark between two places in the text. */
const sameClause = (text: string, from: number, to: number) => !/[,.;!?:]/.test(text.slice(from, to));

function turnedDown(text: string, toks: Token[], i: number): boolean {
  const prev = toks[i - 1];
  if (!prev || !sameClause(text, prev.end, toks[i].start)) return false;
  if (NOT_BEFORE.has(prev.norm)) return true;
  const pair = toks[i - 2] ? `${toks[i - 2].norm} ${prev.norm}` : "";
  // "No need to send the drone": "no need" within the few words before.
  const before = toks.slice(Math.max(0, i - 4), i).map((t) => t.norm).join(" ");
  return NOT_PAIRS.has(pair) || / no need\b| pas besoin\b| не треба\b| не потріб/.test(` ${before}`);
}

export interface ReconRequest {
  /** The request as it was said: "send the drone to Track 2". */
  words: string;
  /** What is left for the model and the other readers once the request is cut out. */
  rest: string;
  /** A track named inside the request ("send the drone to Track 2"), or null. */
  n: number | null;
}

/** Tidies what is left after a cut: no stray commas, no space before a full stop. */
function tidy(text: string): string {
  return text
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/[,;:]\s*([.!?])/g, "$1")
    .replace(/([.!?])[.!?]+/g, "$1")
    .replace(/^[\s,;:.!?-]+/, "")
    .replace(/[\s,;:-]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The first request for recon in what was said, cut out of it, or null when there is none. A
 * request runs from its phrase to the next comma or full stop: "send the drone to Track 2, over"
 * keeps "to Track 2" with the request. A word that turns it down just before ("don't send the
 * drone", "pas besoin de drone", "не потрібен дрон") means no request.
 */
export function readRequest(text: string): ReconRequest | null {
  const toks = tokens(text);
  for (let i = 0; i < toks.length; i++) {
    for (const phrase of PHRASES) {
      const after = matchAt(phrase, toks, i);
      if (after < 0) continue;
      if (turnedDown(text, toks, i)) continue;
      // The request runs on to the end of its clause.
      let last = after - 1;
      while (toks[last + 1] && sameClause(text, toks[last].end, toks[last + 1].start)) last++;
      const clauseEnd = toks[last].end;
      // A joiner or who is asking goes with it: "at the station and send the drone", "on a besoin d'un drone".
      let first = i;
      while (toks[first - 1] && LEAD_IN.has(toks[first - 1].norm) && sameClause(text, toks[first - 1].end, toks[first].start)) first--;
      const cutStart = toks[first].start;
      const words = text.slice(toks[i].start, clauseEnd).trim();
      return { words, rest: tidy(text.slice(0, cutStart) + text.slice(clauseEnd)), n: trackNumberSaid(words) };
    }
  }
  return null;
}

/**
 * True when nothing is left but a track's name or radio words ("Track 2", "over"): the
 * transmission was only a request, so there is no report to read.
 */
export function requestOnly(rest: string): boolean {
  const words = fold(rest).split(" ").filter(Boolean);
  return words.every((t) => trackNameWord(t) || FILLER.has(t));
}

/** The track a request is about: the one named in the request, else the one named in what is left. */
export function requestedTrack(req: ReconRequest): number | null {
  return req.n ?? trackNumberSaid(req.rest);
}

/** What is left of a transmission for the model, with a request for recon cut out [234]. */
export interface Split {
  /** The words the model and the word readers get. */
  text: string;
  /** The request said, if any: its words and the track it named. */
  request: { words: string; n: number | null } | null;
  /** True when the transmission was only the request: there is no report to read. */
  only: boolean;
}

/**
 * Cuts a request for recon out of what the model will read [234]. The report endpoint and the
 * Unassigned tray run it on the words after the call sign; the request eval scores it.
 */
export function splitRequest(text: string): Split {
  const req = readRequest(text);
  if (!req) return { text, request: null, only: false };
  const only = requestOnly(req.rest);
  // On its own, the request is about the track named anywhere in the call ("Track 2, request eyes on").
  return { text: req.rest, request: { words: req.words, n: only ? requestedTrack(req) : req.n }, only };
}
