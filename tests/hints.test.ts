import { describe, expect, it } from "vitest";
import hints from "../transmitter/src/hints.generated.json";
import { AREAS, type AreaId } from "../lib/geo/areas";
import { biasTerms, loadGazetteer } from "../lib/geo/gazetteer";

describe("the prompt for Whisper on the phone", () => {
  for (const id of Object.keys(AREAS) as AreaId[]) {
    it(`${id}: the most useful place names first, then the report words`, () => {
      const list = (hints as Record<string, string[]>)[id];
      const words = AREAS[id].speechWords;
      expect(list.slice(-words.length)).toEqual(words);
      const names = list.slice(0, -words.length);
      expect(names.length).toBeGreaterThan(10);
      expect(names).toEqual(biasTerms(loadGazetteer(id), names.length));
    });
  }
});
