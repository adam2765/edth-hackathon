import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYMBOLS, normalizeUkrainian, prepareUkrainian, toIds } from "../lib/tts/ukrainianText";
import reference from "../lib/tts/piperReference.json";
import voice from "../lib/tts/voiceManifest.json";

const CONFIG = `models/piper/${voice.name}/${voice.file}.json`;

describe("Ukrainian voice: symbol table", () => {
  // The model's own config is only on machines that have downloaded the voice.
  it.skipIf(!existsSync(CONFIG))("matches the downloaded model's config", () => {
    const map: Record<string, number[]> = JSON.parse(readFileSync(CONFIG, "utf8")).phoneme_id_map;
    expect(Object.keys(map)).toHaveLength(SYMBOLS.length);
    SYMBOLS.forEach((symbol, id) => expect(map[symbol], JSON.stringify(symbol)).toEqual([id]));
  });

  it("produces the same ids as Piper for the reference sentences", () => {
    for (const c of reference.cases) {
      const { sentences, unsupported } = prepareUkrainian(c.text);
      expect(unsupported).toEqual([]);
      expect(sentences).toHaveLength(1);
      expect(toIds(sentences[0]), c.text).toEqual(c.ids);
    }
  });
});

describe("Ukrainian voice: text preparation", () => {
  it("lowercases, because the voice has no capital letters", () => {
    expect(normalizeUkrainian("Яку Церкву?")).toBe("яку церкву?");
  });

  it("maps typographic apostrophes and dashes onto the voice's own", () => {
    expect(normalizeUkrainian("пам’ятник, мʼякий")).toBe("пам'ятник, м'який");
    expect(normalizeUkrainian("Хрещатик – це вулиця")).toBe("хрещатик — це вулиця");
  });

  it("reads brackets as a pause and drops quotes", () => {
    expect(normalizeUkrainian("Золоті ворота (театр) чи «Золоті ворота» (станція метро)?")).toBe(
      "золоті ворота, театр, чи золоті ворота, станція метро?",
    );
  });

  it("removes stress marks unless asked to keep them", () => {
    expect(normalizeUkrainian("за́мок")).toBe("замок");
    expect(normalizeUkrainian("за́мок", true)).toBe("за́мок");
    expect(toIds("за́мок")).toContain(SYMBOLS.indexOf("́"));
  });

  it("splits into sentences and drops fragments with no letters", () => {
    expect(prepareUkrainian("Не вдалося визначити місце. Назвіть вулицю або орієнтир. ...").sentences).toEqual([
      "не вдалося визначити місце.",
      "назвіть вулицю або орієнтир.",
    ]);
  });

  it("reports what the voice cannot say instead of skipping it silently", () => {
    expect(prepareUkrainian("вулиця 8 Березня").unsupported).toEqual(["8"]);
    expect(prepareUkrainian("біля McDonald's").unsupported.sort()).toEqual(["a", "c", "d", "l", "m", "n", "o", "s"]);
    expect(prepareUkrainian("улица Крещатик, мы здесь").unsupported).toEqual(["ы"]);
    expect(prepareUkrainian("Яка станція: Хрещатик чи Майдан Незалежності?").unsupported).toEqual([]);
  });

  it("never lets text inject the start, end or pad symbols", () => {
    expect(prepareUkrainian("так ^ ні $ _").unsupported.sort()).toEqual(["$", "^", "_"]);
    expect(toIds("а^$_б")).toEqual([1, 0, SYMBOLS.indexOf("а"), 0, SYMBOLS.indexOf("б"), 0, 2]);
  });
});
