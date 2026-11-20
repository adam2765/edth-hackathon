/**
 * Text to model input for the Piper voice `uk_UA-ukrainian_tts-medium`.
 *
 * The voice reads characters, not phonemes: lowercase Ukrainian letters, a little punctuation,
 * and three combining marks. Anything else has no id and would be skipped without a sound, so
 * `prepareUkrainian` reports it and the caller can fall back to another voice.
 *
 * The table and the id layout below are our own code. They follow the voice's published
 * config and are checked against Piper's own output in tests/tts.test.ts.
 */

const LETTERS = "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя";
const STRESS = "́"; // combining acute, after the stressed vowel
const BREVE = "̆"; // й is read as и + breve
const DIAERESIS = "̈"; // ї is read as і + diaeresis
const EM_DASH = "—";

/** Every symbol the voice knows. A symbol's id is its position here. */
export const SYMBOLS: readonly string[] = [
  "_", "^", "$", " ", "!", "'", ",", "-", ".", ":", ";", "?",
  ...LETTERS,
  STRESS, BREVE, DIAERESIS, EM_DASH,
];

const PAD = 0; // "_", between every two symbols
const BOS = 1; // "^"
const EOS = 2; // "$"
const SPEAKABLE = new Map(SYMBOLS.map((s, i) => [s, i] as const).slice(3));

export type PreparedText = {
  /** Cleaned text, one entry per sentence. The voice was trained on single sentences. */
  sentences: string[];
  /** Characters the voice cannot say (digits, Latin or Russian-only letters, symbols). */
  unsupported: string[];
};

/** Lowercases and maps everyday typography onto the few symbols the voice knows. */
export function normalizeUkrainian(text: string, keepStress = false): string {
  let t = text.normalize("NFC").toLocaleLowerCase("uk");
  t = t.replace(/[’ʼ‘`´′]/g, "'"); // apostrophes: м’який, мʼякий
  t = t.replace(/[«»„“”"]/g, ""); // quotes carry no sound
  t = t.replace(/[–―−]/g, EM_DASH);
  t = t.replace(/…/g, ".");
  t = t.replace(/[()[\]/]/g, ", "); // "Золоті ворота (театр)" is read with a pause
  if (!keepStress) t = t.replace(/́/g, "");
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s+([,.:;!?])/g, "$1");
  t = t.replace(/([.!?])[.!?]+/g, "$1"); // "..." and "?!" end one sentence, once
  t = t.replace(/[,:;]+([.!?])/g, "$1");
  t = t.replace(/([,:;])(?:\s*[,:;])+/g, "$1");
  return t.replace(/^[,:;\s]+/, "").trim();
}

export function prepareUkrainian(text: string, opts: { keepStress?: boolean } = {}): PreparedText {
  const normalized = normalizeUkrainian(text, opts.keepStress);
  const unsupported = [...new Set([...normalized.normalize("NFD")].filter((c) => !SPEAKABLE.has(c)))];
  const sentences = (normalized.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => [...s].some((c) => LETTERS.includes(c)));
  return { sentences, unsupported };
}

/** Ids for one prepared sentence: start, then each symbol followed by a pad, then end. */
export function toIds(sentence: string): number[] {
  const ids = [BOS, PAD];
  for (const c of sentence.normalize("NFD")) {
    const id = SPEAKABLE.get(c);
    if (id !== undefined) ids.push(id, PAD);
  }
  ids.push(EOS);
  return ids;
}
