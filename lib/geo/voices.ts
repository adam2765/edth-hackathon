/**
 * More than one voice in a transcript.
 *
 * A clip recorded in a crowd holds other people's words too. Speech-to-text on the phone (Whisper)
 * writes a dash where the voice changes: "and I couldn't cover anything. - Heading towards the
 * cemetery. - Many people came up." Each stretch between the marks is a voice turn.
 *
 * The rule, in order:
 *   1. One turn, or at most one turn that looks like a report: nothing changes. The whole
 *      transcript is read once, as before.
 *   2. Two or more turns look like reports: each is read on its own.
 *      - they place the same thing: the first is used
 *      - they name different places: the app asks which one is the speaker's
 *      - one of them cannot be offered as a choice: the app asks the speaker to say it again
 *      - with a last position: a voice that puts the speaker somewhere they could not have reached
 *        since then is dropped; when exactly one voice is left, it is used without a question
 * The app never picks between two places that are both reachable. It cannot tell whose voice is whose.
 *
 * Pure apart from the two functions it is given: the extractor and the resolver.
 */
import { canonTokens, categoryOfToken } from "./gazetteer";
import { distanceM } from "./geo";
import { tokens } from "./normalize";
import { choiceLabels } from "./resolver";
import type { Candidate, GazetteerFeature, Intent, LastPosition, Resolution } from "./types";

type Lang = "en" | "fr" | "uk";

/** More turns than this that look like reports, and the app asks again without reading each one. */
export const MAX_VOICES_READ = 4;

/** Fastest a speaker can plausibly move between two reports, m/s (54 km/h: a vehicle in town). Set high on purpose: a wrong drop hides the real speaker. */
export const MAX_SPEED_MS = 15;
/** Slack for the size of a place and the error of a position, metres. */
const REACH_SLACK_M = 100;

/**
 * How far a speaker could have gone since their last position, metres: 15 m/s for the time since
 * it, plus the position's uncertainty and 100 m [188]. A radio report that would move a unit
 * farther waits for the operator [204].
 */
export function reachM(last: LastPosition, now: number): number {
  const elapsed_s = Math.max(0, now - last.ts) / 1000;
  return MAX_SPEED_MS * elapsed_s + Math.max(last.uncertainty_m ?? 0, last.radius_m ?? 0) + REACH_SLACK_M;
}

/** ">>" anywhere, or a dash at the very start or straight after the end of a sentence. */
const VOICE_MARK = /\s*>>+\s*|(?:^|(?<=[.!?…»”"]))\s*[-–—]\s+/u;
/** Sounds, not words: "[BLANK_AUDIO]", "(wind blowing)", "*sighs*". */
const SOUND_TAG = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g;
const LETTER = /\p{L}/u;

/**
 * The voice turns of a transcript, in order. One turn when no change of voice is marked.
 * A dash inside a sentence ("Saint-Mandé", "Я — біля церкви") is not a change of voice.
 */
export function splitVoices(transcript: string): string[] {
  const parts = transcript
    .split(VOICE_MARK)
    .map((p) => p.trim())
    .filter((p) => LETTER.test(p.replace(SOUND_TAG, "")));
  return parts.length > 1 ? parts : [transcript.trim()];
}

const nameTokenCache = new WeakMap<GazetteerFeature[], Set<string>>();

/** Every word of four letters or more in any place name of the area, as canonical tokens. */
function nameTokens(gazetteer: GazetteerFeature[]): Set<string> {
  let set = nameTokenCache.get(gazetteer);
  if (!set) {
    set = new Set();
    for (const f of gazetteer) for (const n of f.names) for (const t of canonTokens(n)) if (t.length >= 4) set.add(t);
    nameTokenCache.set(gazetteer, set);
  }
  return set;
}

/**
 * A distance or a compass word, as the start of a normalised word: English, French, Ukrainian,
 * Russian. French "est" (east) is left out: it is also "is", and would pass every French sentence.
 */
const MOVE_WORD = /^(north|south|east|west|nord|sud|ouest|metre|meter|kilomet|km$|північ|півден|схід|захід|метр|кілометр|север|юг$|восток|запад)/;
const FIRST_PERSON = new Set(["I", "I'm", "I’m", "I'll", "I’ll", "I've", "I’ve", "I'd", "I’d"]);

/** A capital letter in the middle of a sentence: most likely a name. */
function hasNameLikeWord(turn: string): boolean {
  const words = turn.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/^[^\p{L}]+/u, "");
    if (!w || FIRST_PERSON.has(w.replace(/[^\p{L}'’]+$/u, ""))) continue;
    if (/[.!?…]["»”]?$/.test(words[i - 1])) continue;
    if (/^\p{Lu}/u.test(w)) return true;
  }
  return false;
}

/**
 * Could this turn be a report? A cheap check with no model: a type word ("church", "rue",
 * "кладовище"), a word from a place name of the area, a number, a distance or compass word, or a
 * name-like word. It errs towards yes: a wrong yes costs one more reading, a wrong no could let
 * another voice's place through unasked.
 */
export function mightBeReport(turn: string, gazetteer: GazetteerFeature[], also?: (turn: string) => boolean): boolean {
  if (/\d/.test(turn)) return true;
  if (tokens(turn).some((t) => MOVE_WORD.test(t))) return true;
  const names = nameTokens(gazetteer);
  if (canonTokens(turn).some((t) => categoryOfToken(t) !== undefined || names.has(t))) return true;
  if (hasNameLikeWord(turn)) return true;
  return also ? also(turn) : false;
}

export interface VoiceReading {
  /** 1-based position among the transcript's turns. */
  voice: number;
  text: string;
  intent: Intent;
  resolution: Resolution;
}

/** A reading that says where someone or something is. Small talk read as "other" does not count. */
function counts(r: VoiceReading): boolean {
  return !!r.resolution.track || r.intent.kind !== "other";
}

/** Two readings with the same key place the same thing. "At X" and "towards X" share a key. */
function placeKey(r: VoiceReading): string {
  const res = r.resolution;
  if (res.track) return `track|${res.track.n ?? "new"}|${res.track.kind ?? ""}|${res.status}|${res.evidence.feature_id ?? ""}`;
  if (res.status === "unresolved") return "self|none";
  if (res.status === "ambiguous") return `self|ask|${res.candidates.map((c) => c.id).sort().join(",")}`;
  if (res.evidence.feature_id) return `self|${res.evidence.feature_id}`;
  return `self|pin|${res.pin?.lat.toFixed(4)},${res.pin?.lon.toFixed(4)}`;
}

const SAY_AGAIN: Record<Lang, string> = {
  en: "I heard more than one voice and can't tell which report is yours. Say your position again.",
  fr: "J'ai entendu plusieurs voix et je ne sais pas quel rapport est le vôtre. Redites votre position.",
  uk: "Чути кілька голосів, і незрозуміло, який звіт ваш. Повторіть свою позицію.",
};

function whichIsYours(cands: Candidate[], lang: Lang): string {
  const labels = choiceLabels(cands, lang);
  const list = labels.length <= 1 ? labels.join("") : labels.slice(0, -1).join(", ") + (lang === "fr" ? " ou " : lang === "uk" ? " чи " : ", or ") + labels[labels.length - 1];
  if (lang === "fr") return cands.length === 1 ? `J'ai entendu plusieurs voix. Vous voulez dire ${list} ?` : `J'ai entendu plusieurs voix. Quel lieu est le vôtre : ${list} ?`;
  if (lang === "uk") return cands.length === 1 ? `Чути кілька голосів. Ви маєте на увазі ${list}?` : `Чути кілька голосів. Яке місце ваше: ${list}?`;
  return cands.length === 1 ? `I heard more than one voice. Do you mean ${list}?` : `I heard more than one voice. Which place is yours: ${list}?`;
}

const langOf = (intent: Intent): Lang => (intent.language === "fr" || intent.language === "uk" ? intent.language : "en");
const quote = (s: string) => `"${s.length > 60 ? `${s.slice(0, 57)}...` : s}"`;

function sayAgain(intent: Intent, rule: string, detail: string): Resolution {
  return { status: "unresolved", candidates: [], question: SAY_AGAIN[langOf(intent)], evidence: { rule, detail } };
}

/**
 * One answer from the readings of several voice turns. Null when none of them says where anyone
 * is: the caller then keeps its reading of the whole transcript.
 */
export function combineVoices(
  readings: VoiceReading[],
  heard: number,
  maxChoices = 3,
  last?: LastPosition | null,
  now?: number,
): { intent: Intent; resolution: Resolution } | null {
  const said = readings.filter(counts);
  if (!said.length) return null;
  const first = said[0];
  if (new Set(said.map(placeKey)).size === 1) {
    const note = said.length === 1 ? `${heard} voices heard; read from voice ${first.voice}` : `${heard} voices heard; voices ${said.map((r) => r.voice).join(" and ")} agree, read from voice ${first.voice}`;
    return { intent: first.intent, resolution: { ...first.resolution, evidence: { ...first.resolution.evidence, detail: `${first.resolution.evidence.detail}; ${note}` } } };
  }

  const heardAs = said.map((r) => `voice ${r.voice} ${quote(r.text)} → ${r.resolution.status} (${r.resolution.evidence.rule})`).join("; ");
  // A report about a track and a report about the speaker cannot be offered as two places to tap.
  if (said.some((r) => r.resolution.track)) return { intent: first.intent, resolution: sayAgain(first.intent, "voices_differ", `${heard} voices heard, one about a track; ${heardAs}`) };

  // Context: drop the voices that put the speaker somewhere they could not have reached since their
  // last position. A voice that cannot be checked (a movement, an open question, no place) is kept.
  if (last && now != null) {
    const elapsed_s = Math.max(0, now - last.ts) / 1000;
    const reach_m = reachM(last, now);
    const far: string[] = [];
    const reachable = said.filter((r) => {
      const res = r.resolution;
      const c = res.candidates.find((x) => x.id === res.evidence.feature_id);
      if (r.intent.kind !== "position" || res.status !== "resolved" || !c) return true;
      const d = distanceM(last, c);
      if (d <= reach_m) return true;
      far.push(`voice ${r.voice} ${c.name} ${Math.round(d)} m away`);
      return false;
    });
    if (reachable.length === 1 && far.length) {
      const r = reachable[0];
      const why = `${heard} voices heard; ${far.join(", ")}, more than ${Math.round(reach_m)} m reachable in ${Math.round(elapsed_s)} s; read from voice ${r.voice}`;
      return { intent: r.intent, resolution: { ...r.resolution, evidence: { ...r.resolution.evidence, rule: "voices_context", detail: `${r.resolution.evidence.detail}; ${why}` } } };
    }
  }

  const choices: Candidate[] = [];
  const add = (c: Candidate | undefined) => {
    if (c && !choices.some((x) => x.id === c.id)) choices.push(c);
  };
  for (const r of said) {
    const res = r.resolution;
    if (res.status === "ambiguous") res.candidates.forEach(add);
    else if (res.status === "resolved") add(res.candidates.find((c) => c.id === res.evidence.feature_id));
  }
  if (!choices.length) return { intent: first.intent, resolution: sayAgain(first.intent, "voices_differ", `${heard} voices heard, none could be offered as a choice; ${heardAs}`) };
  const top = choices.slice(0, maxChoices);
  return {
    intent: first.intent,
    resolution: {
      status: "ambiguous",
      candidates: top,
      question: whichIsYours(top, langOf(first.intent)),
      evidence: { rule: "voices_differ", detail: `${heard} voices heard and they name different places; ${heardAs}` },
    },
  };
}

export interface ReadVoicesDeps {
  extract: (text: string) => Promise<Intent>;
  /** Places one reading. `text` is what that reading was made from: a turn, or the whole transcript. */
  resolve: (intent: Intent, text: string) => Resolution;
  gazetteer: GazetteerFeature[];
  /** More words that make a turn look like a report, for example the words for a track. */
  alsoReport?: (turn: string) => boolean;
  /** The speaker's last position and the time now: a voice placing them out of reach is dropped. */
  last?: LastPosition | null;
  now?: number;
}

export interface VoicesRead {
  intent: Intent;
  resolution: Resolution;
  /** How many voice turns the transcript holds. */
  voices: number;
  extract_ms: number;
  resolve_ms: number;
}

/** Reads a transcript that may hold more than one voice. See the rule at the top of this file. */
export async function readVoices(transcript: string, deps: ReadVoicesDeps): Promise<VoicesRead> {
  // Wall-clock time: the readings of several voices run at the same time.
  let extract_ms = 0;
  let resolve_ms = 0;
  const timed = async <T,>(work: () => Promise<T>): Promise<T> => {
    const s = performance.now();
    try {
      return await work();
    } finally {
      extract_ms += performance.now() - s;
    }
  };
  const resolve = (intent: Intent, text: string) => {
    const s = performance.now();
    try {
      return deps.resolve(intent, text);
    } finally {
      resolve_ms += performance.now() - s;
    }
  };
  const done = (intent: Intent, resolution: Resolution, voices: number): VoicesRead => ({ intent, resolution, voices, extract_ms: Math.round(extract_ms), resolve_ms: Math.round(resolve_ms) });

  const turns = splitVoices(transcript);
  const whole = await timed(() => deps.extract(transcript));
  if (turns.length < 2) return done(whole, resolve(whole, transcript), 1);

  // Turns that look like reports, plus the one the whole reading took its place from: if the
  // model found a place in a turn the cheap check passed over, that turn is a report too.
  const said = whole.landmark_text ? tokens(whole.landmark_text).join(" ") : "";
  const likely = turns
    .map((text, i) => ({ text, voice: i + 1 }))
    .filter((t) => mightBeReport(t.text, deps.gazetteer, deps.alsoReport) || (!!said && tokens(t.text).join(" ").includes(said)));

  const asBefore = () => {
    const resolution = resolve(whole, transcript);
    const note = `${turns.length} voices heard, ${likely.length ? "one looks" : "none looks"} like a report`;
    return done(whole, { ...resolution, evidence: { ...resolution.evidence, detail: `${resolution.evidence.detail}; ${note}` } }, turns.length);
  };
  if (likely.length < 2) return asBefore();
  if (likely.length > MAX_VOICES_READ) {
    return done(whole, sayAgain(whole, "voices_too_many", `${turns.length} voices heard, ${likely.length} look like reports; more than ${MAX_VOICES_READ} are not read one by one`), turns.length);
  }

  const intents = await timed(() => Promise.all(likely.map((t) => deps.extract(t.text))));
  const readings = likely.map((t, i) => ({ ...t, intent: intents[i], resolution: resolve(intents[i], t.text) }));
  const combined = combineVoices(readings, turns.length, 3, deps.last, deps.now);
  return combined ? done(combined.intent, combined.resolution, turns.length) : asBefore();
}
