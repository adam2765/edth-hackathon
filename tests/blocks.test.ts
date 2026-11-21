import { describe, expect, it } from "vitest";
import { blocksSaid } from "../lib/geo/blocks";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { distanceM, nearestPointOnLines } from "../lib/geo/geo";
import { resolve } from "../lib/geo/resolver";
import { resolveReport } from "../lib/geo/tracks";
import type { Intent, LastPosition } from "../lib/geo/types";

const gaz = loadGazetteer("vincennes");
const NOW = Date.parse("2026-11-21T09:00:00Z");
const street = (name: string) => gaz.find((f) => f.category === "street" && f.name === name)!;
/** A fresh last position on a street, as the coordinator sends it in a mission [117]. */
const on = (name: string, near: { lat: number; lon: number }): LastPosition => {
  const p = nearestPointOnLines(near, street(name).lines!);
  return { lat: p.lat, lon: p.lon, ts: NOW - 60_000, radius_m: 0, street: street(name).id };
};
const FONTENAY = on("Rue de Fontenay", { lat: 48.849077, lon: 2.43891 });
const PARIS = on("Avenue de Paris", { lat: 48.8475, lon: 2.43 });
const CASTLE = gaz.find((f) => f.name === "Château de Vincennes" && f.category === "castle")!;

function intent(p: Partial<Intent>): Intent {
  return { kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: null, language: "en", confidence: 0.9, ...p };
}
const base = { now: NOW, gazetteer: gaz, observer: "ALPHA 1" };
/** Hosted Mistral's reading of "Unknown Contact, two blocks east." in mission vincennes-21: the speaker moving east. */
const contact = intent({ kind: "movement", relation: "towards", direction: "east", distance_m: null, confidence: 0.8 });

describe("a count of blocks is read from the words", () => {
  it("in English, French, Ukrainian and Russian", () => {
    const counts: [string, number][] = [
      ["Unknown Contact, two blocks east.", 2],
      ["2 blocks north", 2],
      ["a block north", 1],
      ["a couple of blocks east", 2],
      ["one street east", 1],
      ["three crossings west", 3],
      ["deux pâtés de maisons à l'est", 2],
      ["deux rues plus loin à l'est", 2],
      ["через два квартали на схід", 2],
      ["дві вулиці на північ", 2],
      ["в двух кварталах к востоку", 2],
    ];
    for (const [said, n] of counts) expect(blocksSaid(said), said).toEqual({ n });
  });

  it('"a few blocks" is a block with no count', () => {
    expect(blocksSaid("a few blocks east")).toEqual({ n: null });
    expect(blocksSaid("quelques rues à l'est")).toBeNull();
    expect(blocksSaid("кілька кварталів на схід")).toEqual({ n: null });
  });

  it("a block word needs a count in front, and a street word a number, not an article", () => {
    for (const said of ["Road block east of the bridge", "Unknown truck on rue de Fontenay", "On a street east of the castle", "Une rue à l'est du château", "Moving down Avenue de Nogent", "Two vehicles on the street", "Contact au nord du 12 rue de Fontenay"]) {
      expect(blocksSaid(said), said).toBeNull();
    }
  });
});

describe("counting blocks along a street", () => {
  it("both counts agree: placed at that crossing", () => {
    const r = resolve({ ...base, intent: intent({ kind: "movement", direction: "east" }), transcript: "Moving two blocks east", lastPosition: FONTENAY });
    expect(r).toMatchObject({ status: "resolved", estimated: true, evidence: { rule: "blocks_counted" } });
    expect(r.candidates[0].name).toBe("Rue de Fontenay / Avenue de Vorges / Rue de Condé-sur-Noireau");
    expect(Math.round(distanceM(FONTENAY, r.pin!))).toBeGreaterThan(80);
    expect(r.pin!.lon).toBeGreaterThan(FONTENAY.lon);
  });

  it("the counts disagree: the app asks which crossing", () => {
    // Avenue de Paris going east: Rue Segond joins from one side at 79 m, Rue de Colmar and Rue des
    // Vignerons cross it at 147 m, and the next street right across is Rue de Montreuil at 368 m.
    const r = resolve({ ...base, intent: intent({ kind: "movement", direction: "east" }), transcript: "Moving two blocks east", lastPosition: PARIS });
    expect(r.status).toBe("ambiguous");
    expect(r.evidence.rule).toBe("blocks_ambiguous");
    expect(r.question).toBe("Which crossing on Avenue de Paris: Rue de Colmar / Rue des Vignerons, or Avenue du Général de Gaulle / Rue de Montreuil?");
    expect(r.candidates.map((c) => c.distance_m)).toEqual([147, 368]);
    expect(r.candidates.every((c) => c.placement.pin && c.placement.estimated)).toBe(true);
  });

  it("the speaker's circle is added: a count from an unsure place is unsure", () => {
    const r = resolve({ ...base, intent: intent({ kind: "movement", direction: "east" }), transcript: "Moving two blocks east", lastPosition: { ...FONTENAY, radius_m: 120 } });
    expect(r.radius_m).toBe(170);
  });

  it("a track: placed at the crossing, and the speaker stays put", () => {
    const r = resolveReport({ ...base, intent: contact, transcript: "Unknown Contact, two blocks east.", lastPosition: FONTENAY });
    expect(r).toMatchObject({ status: "resolved", evidence: { rule: "blocks_counted" } });
    expect(r.pin).toBeUndefined();
    expect(r.track).toMatchObject({ opened: true, affiliation: null, label: "Rue de Fontenay / Avenue de Vorges / Rue de Condé-sur-Noireau" });
    expect(r.track!.placement!.pin!.lon).toBeGreaterThan(FONTENAY.lon);
  });

  it("a track the counts disagree on: the choices move only the track", () => {
    const r = resolveReport({ ...base, intent: contact, transcript: "Unknown Contact, two blocks east.", lastPosition: PARIS });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
    for (const c of r.candidates) {
      expect(c.placement).toEqual({});
      expect(c.track_placement?.pin).toBeDefined();
    }
  });

  it('"two blocks east of Rue de Montreuil": from where it crosses the speaker\'s street, along it', () => {
    const r = resolveReport({
      ...base,
      intent: intent({ subject: "track", landmark_name: "Rue de Montreuil", landmark_category: "street", relation: "east_of" }),
      transcript: "Unknown contact, two blocks east of Rue de Montreuil.",
      lastPosition: PARIS,
    });
    expect(r.status).toBe("resolved");
    expect(r.track?.label).toBe("Avenue de Paris / Avenue du Château");
  });

  it('"two blocks east on Avenue de Paris": the compass word is the way counted, not the way the thing is going', () => {
    const r = resolveReport({
      ...base,
      intent: intent({ subject: "track", landmark_name: "Avenue de Paris", landmark_category: "street", relation: "at", direction: "east" }),
      transcript: "Unknown contact, two blocks east on Avenue de Paris.",
      lastPosition: PARIS,
    });
    expect(r.status).toBe("ambiguous");
    expect(r.question).toContain("Rue de Montreuil");
  });
});

describe("when blocks cannot be counted, the app asks how far", () => {
  it("no street there runs that way", () => {
    const r = resolve({ ...base, intent: intent({ kind: "movement", direction: "east" }), transcript: "Moving two blocks east", lastPosition: { lat: CASTLE.lat, lon: CASTLE.lon, ts: NOW - 60_000 } });
    expect(r).toMatchObject({ status: "unresolved", evidence: { rule: "blocks_uncounted" }, question: "How far east? Or name a place near it." });
  });

  it('"a few blocks", or more than six', () => {
    expect(resolveReport({ ...base, intent: contact, transcript: "Unknown contact, a few blocks east.", lastPosition: FONTENAY })).toMatchObject({
      status: "unresolved",
      evidence: { rule: "blocks_uncounted" },
      question: "How far east is it? Or name a place near it.",
    });
    expect(resolve({ ...base, intent: intent({ kind: "movement", direction: "east" }), transcript: "Moving seven blocks east", lastPosition: FONTENAY }).evidence.rule).toBe("blocks_uncounted");
  });

  it("from a named street, the question names it", () => {
    const north = (language: Intent["language"]) =>
      resolveReport({
        ...base,
        intent: intent({ subject: "track", landmark_name: "Avenue de Paris", landmark_category: "street", relation: "north_of", language }),
        transcript: "Unknown contact, seven blocks north of Avenue de Paris.",
        lastPosition: PARIS,
      }).question;
    expect(north("en")).toBe("How far north of Avenue de Paris? Or name a place near it.");
    expect(north("fr")).toBe("À quelle distance au nord d'Avenue de Paris ? Ou donnez un lieu proche.");
    expect(north("uk")).toBe("Як далеко на північ? Або назвіть орієнтир поруч.");
  });

  it("from a place that is not a street", () => {
    const r = resolveReport({ ...base, intent: intent({ subject: "track", landmark_category: "church", relation: "east_of" }), transcript: "Unknown contact two blocks east of the church", lastPosition: FONTENAY });
    expect(r).toMatchObject({ status: "unresolved", evidence: { rule: "blocks_uncounted" } });
    expect(r.track?.placement).toBeUndefined();
  });

  it("with no last position, the app asks where the speaker is", () => {
    expect(resolveReport({ ...base, intent: contact, transcript: "Unknown Contact, two blocks east.", lastPosition: null })).toMatchObject({
      status: "unresolved",
      evidence: { rule: "blocks_no_start" },
      question: "I don't know where you are. Name a place near what you see.",
    });
  });

  it("a distance said wins over a count", () => {
    const r = resolve({ ...base, intent: intent({ kind: "movement", direction: "east", distance_m: 200 }), transcript: "Two blocks, 200 metres east", lastPosition: FONTENAY });
    expect(r.evidence.rule).toBe("dead_reckoned");
  });
});
