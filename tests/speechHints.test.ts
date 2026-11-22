import { describe, expect, it } from "vitest";
import { AREAS, SPEAKER_PHRASES, speechHints, whisperPrompt, WHISPER_PROMPT_PLACES } from "../lib/geo/areas";
import { biasTerms, loadGazetteer } from "../lib/geo/gazetteer";

describe("the prompt for offline Whisper [246]", () => {
  const vincennes = biasTerms(loadGazetteer("vincennes"), WHISPER_PROMPT_PLACES);

  it("is the roster, then ten place names likeliest first, ending in a full stop", () => {
    const p = whisperPrompt(["ALPHA 1", "BRAVO 2"], vincennes)!;
    expect(p.endsWith(".")).toBe(true);
    const parts = p.slice(0, -1).split(", ");
    expect(parts.slice(0, 2)).toEqual(["ALPHA 1", "BRAVO 2"]);
    expect(parts.slice(2)).toEqual(vincennes);
    expect(parts).toHaveLength(12);
    expect(parts.slice(2, 4)).toEqual(["Bérault", "Château de Vincennes"]);
  });

  it("holds no report words, so none can turn up as a track", () => {
    const p = whisperPrompt([], vincennes)!;
    for (const w of AREAS.vincennes.speechWords) expect(p).not.toContain(w);
  });

  it("is left out where the place names are in Cyrillic", () => {
    expect(whisperPrompt(["ALPHA 1"], biasTerms(loadGazetteer("kyiv"), WHISPER_PROMPT_PLACES))).toBeNull();
    expect(whisperPrompt(["ALPHA 1"], biasTerms(loadGazetteer("izium"), WHISPER_PROMPT_PLACES))).toBeNull();
  });

  it("keeps ten call signs at most, and does not change the list it is given", () => {
    const roster = Array.from({ length: 30 }, (_, i) => `UNIT ${i + 1}`);
    const before = [...vincennes];
    expect(whisperPrompt(roster, vincennes)!.slice(0, -1).split(", ")).toHaveLength(20);
    expect(vincennes).toEqual(before);
  });
});

describe("speech-to-text hints for a speaker of another language [190]", () => {
  const placeNames = Array.from({ length: 100 }, (_, i) => `Place ${i}`);

  it("leaves the area's hints alone when the speaker speaks the area's language, or none is pinned", () => {
    expect(speechHints(AREAS.kyiv, placeNames, "uk")).toBe(placeNames);
    expect(speechHints(AREAS.vincennes, placeNames, "fr")).toBe(placeNames);
    expect(speechHints(AREAS.kyiv, placeNames, null)).toBe(placeNames);
  });

  it("puts the speaker's phrases first and keeps 100 hints at most", () => {
    const hints = speechHints(AREAS.kyiv, placeNames, "fr");
    expect(hints.slice(0, SPEAKER_PHRASES.fr.length)).toEqual(SPEAKER_PHRASES.fr);
    expect(hints).toHaveLength(100);
    expect(hints).toContain("Place 0");
    expect(speechHints(AREAS.vincennes, placeNames, "uk").slice(0, SPEAKER_PHRASES.uk.length)).toEqual(SPEAKER_PHRASES.uk);
  });

  it("gives English speakers phrases on every map, since no area is English", () => {
    for (const area of Object.values(AREAS)) expect(speechHints(area, placeNames, "en")[0]).toBe(SPEAKER_PHRASES.en[0]);
  });
});
