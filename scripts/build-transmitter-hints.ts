/**
 * Writes transmitter/src/hints.generated.json: a short list of place names per area that the
 * transmitter gives to speech-to-text on the phone as a hint (Whisper's "initial prompt").
 * The list is the head of the same bias list the server sends to Mistral.
 * Run: npm run scenarios
 */
import { writeFileSync } from "node:fs";
import { AREAS, type AreaId } from "../lib/geo/areas";
import { biasTerms, loadGazetteer } from "../lib/geo/gazetteer";

// Whisper's prompt holds about 224 tokens. Latin names cost roughly 4 tokens each and
// Cyrillic names roughly 8, so the Kyiv and Izium lists are shorter.
const MAX_NAMES: Record<AreaId, number> = { vincennes: 40, kyiv: 24, izium: 24 };

const out: Record<string, string[]> = {};
for (const id of Object.keys(AREAS) as AreaId[]) {
  out[id] = biasTerms(loadGazetteer(id), MAX_NAMES[id]);
  console.log(`${id}: ${out[id].length} names, e.g. ${out[id].slice(0, 5).join(", ")}`);
}
writeFileSync("transmitter/src/hints.generated.json", JSON.stringify(out, null, 2) + "\n");
