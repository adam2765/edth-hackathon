import { describe, expect, it } from "vitest";
import { AREAS, SPEAKER_PHRASES, speechHints } from "../lib/geo/areas";

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
