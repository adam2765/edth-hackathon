/**
 * Writes transmitter/src/hints.generated.json: per area, the words the transmitter gives Whisper on
 * the phone as its prompt (the "initial prompt"), in the order they are joined: place names, most
 * useful first, then the area's report words ("hostile drone", "Track 2").
 *
 * Whisper keeps only the last 223 tokens of a prompt and drops the start without a word
 * (whisper.cpp: n_text_ctx / 2 - 1), and the start is where the most useful names are. So the names
 * are fitted to the budget, counted the way whisper.cpp counts, with the phone's model on this Mac
 * (npm run setup). Without it, the counts measured on 21 Nov are used; they fit only as long as the
 * gazetteer is unchanged.
 * Run: npm run scenarios
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AREAS, type AreaId } from "../lib/geo/areas";
import { biasTerms, loadGazetteer } from "../lib/geo/gazetteer";

const MODEL = process.env.WHISPER_MODEL || "transmitter/assets/models/ggml-base-q5_1.bin";
const PROMPT_TOKENS = 223;
/** Names that fit beside the report words, counted with the model on 21 Nov. */
const FALLBACK_NAMES: Record<AreaId, number> = { vincennes: 29, kyiv: 24, izium: 19 };

/** Counts tokens as whisper.cpp does: split into words, then take the longest piece in its vocabulary. */
function tokenCounter(path: string): (text: string) => number {
  const buf = readFileSync(path);
  let p = 4 + 11 * 4; // magic, hyperparameters
  p += 8 + buf.readInt32LE(p) * buf.readInt32LE(p + 4) * 4; // mel filters
  const vocab = new Set<string>();
  for (let i = 0, n = buf.readInt32LE(p), q = p + 4; i < n; i++) {
    const len = buf.readUInt32LE(q);
    vocab.add(buf.subarray(q + 4, q + 4 + len).toString("latin1"));
    q += 4 + len;
  }
  // On bytes, as in C++: only ASCII letters and digits are letters and digits. Spaces are spelled
  // out, because \s would also match 0xA0, a byte inside many UTF-8 letters.
  const WORD = /'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?[0-9]+| ?[^ \t\n\v\f\rA-Za-z0-9]+|[ \t\n\v\f\r]+(?![^ \t\n\v\f\r])|[ \t\n\v\f\r]+/g;
  return (text) => {
    let n = 0;
    for (const [word] of Buffer.from(text, "utf8").toString("latin1").matchAll(WORD)) {
      for (let i = 0; i < word.length; ) {
        let j = word.length;
        while (j > i && !vocab.has(word.slice(i, j))) j--;
        if (j > i) n++;
        i = j > i ? j : i + 1;
      }
    }
    return n;
  };
}

const count = existsSync(MODEL) ? tokenCounter(MODEL) : null;
if (!count) console.warn(`${MODEL} not found (npm run setup puts it there): using the counts measured on 21 Nov, not checked`);

const prompt = (names: string[], words: string[]) => [...names, ...words];
const out: Record<string, string[]> = {};
for (const id of Object.keys(AREAS) as AreaId[]) {
  const words = AREAS[id].speechWords;
  const names = biasTerms(loadGazetteer(id), 80);
  let n = Math.min(FALLBACK_NAMES[id], names.length);
  if (count) {
    n = 0;
    while (n < names.length && count(prompt(names.slice(0, n + 1), words).join(", ")) <= PROMPT_TOKENS) n++;
  }
  out[id] = prompt(names.slice(0, n), words);
  const tokens = count ? `, ${count(out[id].join(", "))} of ${PROMPT_TOKENS} tokens` : "";
  console.log(`${id}: ${n} names and ${words.length} report words${tokens}; first: ${names.slice(0, 3).join(", ")}`);
}
writeFileSync("transmitter/src/hints.generated.json", JSON.stringify(out, null, 2) + "\n");
