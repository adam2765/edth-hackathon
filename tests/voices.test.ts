import { describe, expect, it } from "vitest";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { resolve } from "../lib/geo/resolver";
import { MAX_VOICES_READ, combineVoices, mightBeReport, readVoices, splitVoices, type VoiceReading } from "../lib/geo/voices";
import type { Intent, LastPosition, Resolution } from "../lib/geo/types";

const gaz = loadGazetteer();
const NOW = Date.parse("2026-11-21T10:00:00Z");
const fromMairie: LastPosition = { lat: 48.84765, lon: 2.43977, ts: NOW - 60_000, radius_m: 80 };
const BERAULT = gaz.find((f) => f.name === "Bérault" && f.category === "metro_station")!;
const CEMETERY = gaz.find((f) => f.name === "Cimetière ancien" && f.category === "cemetery")!;

// The report from the demo mission, 20 Nov 19:35: only the middle sentence was the speaker.
const LOGGED = "and I couldn't cover anything. - Heading towards the cemetery. - Many people came up and I was able to explain them.";

function intent(p: Partial<Intent>): Intent {
  return { kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: "at", language: "en", confidence: 0.9, ...p };
}
const OTHER = intent({ kind: "other", relation: null });
const TO_CEMETERY = intent({ kind: "movement", landmark_text: "the cemetery", landmark_category: "cemetery", relation: "towards" });
const AT_BERAULT = intent({ landmark_text: "Bérault", landmark_name: "Bérault" });

/** A stand-in for the model: what it would read from each text, and a count of how often it was asked. */
function reader(readings: Record<string, Intent>) {
  const asked: string[] = [];
  const extract = async (text: string) => {
    asked.push(text);
    return readings[text] ?? OTHER;
  };
  const place = (i: Intent, text: string) => resolve({ intent: i, transcript: text, lastPosition: fromMairie, now: NOW, gazetteer: gaz });
  return { asked, deps: { extract, resolve: place, gazetteer: gaz } };
}

describe("splitVoices", () => {
  it("splits the logged report into its three voices", () => {
    expect(splitVoices(LOGGED)).toEqual(["and I couldn't cover anything.", "Heading towards the cemetery.", "Many people came up and I was able to explain them."]);
  });

  it("splits at a dash that opens the text, and at >>", () => {
    expect(splitVoices("- I'm at the church. - Copy that.")).toEqual(["I'm at the church.", "Copy that."]);
    expect(splitVoices("I'm at the church >> Where is he?")).toEqual(["I'm at the church", "Where is he?"]);
  });

  it("leaves a dash inside a sentence alone", () => {
    for (const one of ["Heading towards Saint-Mandé town hall.", "Я — біля церкви.", "Je suis devant la mairie - celle de Vincennes.", "Moved 300 metres north-east."]) {
      expect(splitVoices(one), one).toEqual([one]);
    }
  });

  it("does not count a sound as a voice", () => {
    expect(splitVoices("[BLANK_AUDIO] - I'm at the church. - (wind blowing)")).toEqual(["[BLANK_AUDIO] - I'm at the church. - (wind blowing)"]);
  });
});

describe("mightBeReport", () => {
  it("passes small talk over and keeps anything that could name a place", () => {
    const [before, report, after] = splitVoices(LOGGED);
    expect(mightBeReport(before, gaz)).toBe(false);
    expect(mightBeReport(report, gaz)).toBe(true);
    expect(mightBeReport(after, gaz)).toBe(false);
    for (const yes of ["Je suis devant la mairie.", "Я біля церкви.", "Moved 300 metres north.", "we went about two kilometres", "I'm at Bayreauld.", "heading to berault"]) {
      expect(mightBeReport(yes, gaz), yes).toBe(true);
    }
    for (const no of ["Il est parti hier soir.", "I'm fine, thanks.", "Так, я зрозумів."]) expect(mightBeReport(no, gaz), no).toBe(false);
  });

  it("takes more words from the caller", () => {
    expect(mightBeReport("hostile drone overhead", gaz)).toBe(false);
    expect(mightBeReport("hostile drone overhead", gaz, (t) => /drone/.test(t))).toBe(true);
  });
});

describe("readVoices", () => {
  it("one voice: reads the transcript once, as before", async () => {
    const { asked, deps } = reader({ "I'm at Bérault.": AT_BERAULT });
    const r = await readVoices("I'm at Bérault.", deps);
    expect(asked).toEqual(["I'm at Bérault."]);
    expect(r.voices).toBe(1);
    expect(r.resolution.status).toBe("resolved");
    expect(r.resolution.evidence.feature_id).toBe(BERAULT.id);
    expect(r.resolution.evidence.detail).not.toMatch(/voices/);
  });

  it("the logged report: other voices that name no place change nothing and cost no extra reading", async () => {
    const { asked, deps } = reader({ [LOGGED]: TO_CEMETERY });
    const r = await readVoices(LOGGED, deps);
    expect(asked).toEqual([LOGGED]);
    expect(r.voices).toBe(3);
    expect(r.resolution.status).toBe("resolved");
    expect(r.resolution.heading_to?.id).toBe(CEMETERY.id);
    expect(r.resolution.evidence.detail).toMatch(/3 voices heard, one looks like a report/);
  });

  it("two voices name different places: asks which is the speaker's, each choice with its own placement", async () => {
    const said = "I'm at Bérault. - Heading towards the cemetery.";
    // The whole transcript read alone would have gone to the cemetery without a question.
    const { asked, deps } = reader({ [said]: TO_CEMETERY, "I'm at Bérault.": AT_BERAULT, "Heading towards the cemetery.": TO_CEMETERY });
    const r = await readVoices(said, deps);
    expect(asked).toEqual([said, "I'm at Bérault.", "Heading towards the cemetery."]);
    expect(r.resolution.status).toBe("ambiguous");
    expect(r.resolution.pin).toBeUndefined();
    expect(r.resolution.evidence.rule).toBe("voices_differ");
    expect(r.resolution.candidates.map((c) => c.id)).toEqual([BERAULT.id, CEMETERY.id]);
    expect(r.resolution.question).toBe("I heard more than one voice. Which place is yours: Bérault, or Cimetière ancien?");
    const [station, cemetery] = r.resolution.candidates;
    expect(station.placement.pin).toEqual({ lat: BERAULT.lat, lon: BERAULT.lon });
    expect(station.placement.heading_to).toBeUndefined();
    expect(cemetery.placement.heading_to?.id).toBe(CEMETERY.id);
  });

  it("two voices name the same place: no question", async () => {
    const said = "I'm at Bérault. - Yes, he is at Bérault metro.";
    const { deps } = reader({ [said]: AT_BERAULT, "I'm at Bérault.": AT_BERAULT, "Yes, he is at Bérault metro.": intent({ landmark_text: "Bérault metro", landmark_name: "Bérault", landmark_category: "metro_station" }) });
    const r = await readVoices(said, deps);
    expect(r.resolution.status).toBe("resolved");
    expect(r.resolution.evidence.feature_id).toBe(BERAULT.id);
    expect(r.resolution.evidence.detail).toMatch(/voices 1 and 2 agree/);
  });

  it("one voice names a place that is not on the map: offers the other, and never places it unasked", async () => {
    const said = "I'm at Zorglub Plaza. - Heading towards the cemetery.";
    const { deps } = reader({ [said]: TO_CEMETERY, "I'm at Zorglub Plaza.": intent({ landmark_text: "Zorglub Plaza", landmark_name: "Zorglub Plaza" }), "Heading towards the cemetery.": TO_CEMETERY });
    const r = await readVoices(said, deps);
    expect(r.resolution.status).toBe("ambiguous");
    expect(r.resolution.candidates.map((c) => c.id)).toEqual([CEMETERY.id]);
    expect(r.resolution.question).toBe("I heard more than one voice. Do you mean Cimetière ancien?");
  });

  it("a place the cheap check passed over still counts when the model found it", async () => {
    // Lower case, misspelled, no type word: nothing marks "bayreauld" as a place but the model's reading.
    const said = "i'm at bayreauld. - Heading towards the cemetery.";
    const lost = intent({ landmark_text: "bayreauld", landmark_name: "bayreauld" });
    expect(mightBeReport("i'm at bayreauld.", gaz)).toBe(false);
    const { asked, deps } = reader({ [said]: lost, "i'm at bayreauld.": lost, "Heading towards the cemetery.": TO_CEMETERY });
    const r = await readVoices(said, deps);
    expect(asked).toHaveLength(3);
    expect(r.resolution.status).toBe("ambiguous");
    expect(r.resolution.evidence.rule).toBe("voices_differ");
  });

  it("no voice names a place: the usual prompt", async () => {
    const said = "Radio check. - I'm at home, thanks.";
    const { deps } = reader({});
    const r = await readVoices(said, deps);
    expect(r.resolution.status).toBe("unresolved");
    expect(r.resolution.evidence.rule).not.toMatch(/^voices_/);
  });

  it("asks in the speaker's language", async () => {
    const fr = "Je suis à Bérault. - Je me dirige vers le cimetière.";
    const a = reader({ "Je suis à Bérault.": { ...AT_BERAULT, language: "fr" }, "Je me dirige vers le cimetière.": { ...TO_CEMETERY, language: "fr" } });
    expect((await readVoices(fr, a.deps)).resolution.question).toBe("J'ai entendu plusieurs voix. Quel lieu est le vôtre : Bérault ou Cimetière ancien ?");
    const uk = "Я на станції Bérault. - Рухаюсь до кладовища.";
    const b = reader({ "Я на станції Bérault.": { ...AT_BERAULT, language: "uk" }, "Рухаюсь до кладовища.": { ...TO_CEMETERY, language: "uk" } });
    expect((await readVoices(uk, b.deps)).resolution.question).toBe("Чути кілька голосів. Яке місце ваше: Bérault чи Cimetière ancien?");
  });

  it("too many voices that look like reports: asks again without reading each one", async () => {
    const turns = Array.from({ length: MAX_VOICES_READ + 1 }, (_, i) => `I'm at the church number ${i + 1}.`);
    const { asked, deps } = reader({});
    const r = await readVoices(turns.join(" - "), deps);
    expect(asked).toHaveLength(1);
    expect(r.resolution.status).toBe("unresolved");
    expect(r.resolution.evidence.rule).toBe("voices_too_many");
    expect(r.resolution.question).toMatch(/more than one voice/);
  });
});

describe("combineVoices", () => {
  const placed = (voice: number, text: string, i: Intent): VoiceReading => ({ voice, text, intent: i, resolution: resolve({ intent: i, transcript: text, lastPosition: fromMairie, now: NOW, gazetteer: gaz }) });

  it("a report about a track and a position are never offered as two places", () => {
    const self = placed(1, "I'm at Bérault.", AT_BERAULT);
    const about: Resolution = { status: "resolved", candidates: [], track: { n: null, opened: true, affiliation: "hostile", kind: "vehicle", count: 2, text: "two vehicles", heading: null }, evidence: { rule: "track_placed", detail: "" } };
    const r = combineVoices([self, { voice: 2, text: "Two hostile vehicles at the cemetery.", intent: TO_CEMETERY, resolution: about }], 2)!;
    expect(r.resolution.status).toBe("unresolved");
    expect(r.resolution.candidates).toEqual([]);
    expect(r.resolution.evidence.rule).toBe("voices_differ");
    expect(r.resolution.question).toMatch(/Say your position again/);
  });

  it("returns nothing when no voice says where anyone is", () => {
    expect(combineVoices([placed(1, "Radio check.", OTHER), placed(2, "Copy.", OTHER)], 2)).toBeNull();
  });
});
