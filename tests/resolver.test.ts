import { describe, expect, it } from "vitest";
import { resolve } from "../lib/geo/resolver";
import { biasTerms, loadGazetteer, nameScore, searchByName } from "../lib/geo/gazetteer";
import { distanceM } from "../lib/geo/geo";
import type { Intent, LastPosition } from "../lib/geo/types";

const gaz = loadGazetteer();
const NOW = Date.parse("2026-11-20T16:00:00Z");
const byName = (n: string, cat?: string) => gaz.find((f) => f.name === n && (!cat || f.category === cat))!;

const BERAULT = byName("Bérault", "metro_station");
const CHATEAU_METRO = byName("Château de Vincennes", "metro_station");
const CHATEAU_CASTLE = byName("Château de Vincennes", "castle");
const MAIRIE_VINCENNES = byName("Mairie de Vincennes", "town_hall");

function intent(p: Partial<Intent>): Intent {
  return {
    kind: "position",
    landmark_text: null,
    landmark_name: null,
    landmark_category: null,
    relation: "at",
    language: "en",
    confidence: 0.9,
    ...p,
  };
}
const at = (f: { lat: number; lon: number }, ageMin = 1): LastPosition => ({ lat: f.lat, lon: f.lon, ts: NOW - ageMin * 60_000 });

describe("gazetteer fixtures this suite relies on", () => {
  it("has the features used below", () => {
    expect(BERAULT).toBeDefined();
    expect(CHATEAU_METRO).toBeDefined();
    expect(CHATEAU_CASTLE).toBeDefined();
    expect(MAIRIE_VINCENNES).toBeDefined();
  });
});

describe("resolver", () => {
  it("unique named place resolves", () => {
    const r = resolve({ intent: intent({ landmark_name: "Bérault", landmark_text: "Bérault" }), transcript: "I'm at Bérault", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(BERAULT.id);
    expect(r.evidence.rule).toBe("named_unique");
    expect(r.radius_m).toBe(30);
  });

  it("accent-free and slightly misspelled names still match", () => {
    const r = resolve({ intent: intent({ landmark_name: "Berrault" }), transcript: "at Berrault", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(BERAULT.id);
  });

  it("a name shared by a castle and a metro station is ambiguous", () => {
    const r = resolve({
      intent: intent({ landmark_name: "Château de Vincennes", landmark_category: "castle", landmark_text: "the château de Vincennes" }),
      transcript: "I'm at the château de Vincennes",
      now: NOW,
      gazetteer: gaz,
    });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((c) => c.id).sort()).toEqual([CHATEAU_CASTLE.id, CHATEAU_METRO.id].sort());
    expect(r.question).toMatch(/castle/);
    expect(r.question).toMatch(/station/);
    // every choice carries a ready placement for the tap
    for (const c of r.candidates) expect(c.placement.pin).toBeDefined();
  });

  it("an explicit category word outside the name narrows a shared name", () => {
    const r = resolve({
      intent: intent({ landmark_name: "Château de Vincennes", landmark_category: "metro_station" }),
      transcript: "I'm at the Château de Vincennes metro station",
      now: NOW,
      gazetteer: gaz,
    });
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(CHATEAU_METRO.id);
  });

  it("an unknown name with no category is unresolved", () => {
    const r = resolve({ intent: intent({ landmark_name: "Gare du Nord" }), transcript: "I'm at Gare du Nord", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("unresolved");
    expect(r.question).toBeTruthy();
    expect(r.pin).toBeUndefined();
  });

  it("an unknown name with a category asks among that category instead of guessing", () => {
    const r = resolve({
      intent: intent({ landmark_name: "Notre-Dame de Paris", landmark_category: "church" }),
      transcript: "I'm at the church Notre-Dame de Paris",
      now: NOW,
      gazetteer: gaz,
    });
    // "Église Notre-Dame" exists in Vincennes, so either it matches by name (and is unique) or we ask; never a silent guess elsewhere.
    expect(["resolved", "ambiguous"]).toContain(r.status);
    if (r.status === "resolved") expect(r.evidence.rule.startsWith("named")).toBe(true);
  });

  it("no landmark at all is unresolved", () => {
    const r = resolve({ intent: intent({ kind: "other", relation: null }), transcript: "radio check", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("unresolved");
    expect(r.evidence.rule).toBe("no_position_in_report");
  });

  it("category only, no last position: ambiguous with up to three choices", () => {
    const r = resolve({ intent: intent({ landmark_name: "the church", landmark_category: "church", relation: "behind" }), transcript: "I am behind the church", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.length).toBe(3);
    expect(r.evidence.rule).toBe("category_ambiguous");
    expect(r.candidates.every((c) => c.category === "church")).toBe(true);
  });

  it("nearest wins with a fresh last position", () => {
    const r = resolve({
      intent: intent({ landmark_name: "mairie", landmark_category: "town_hall", relation: "in_front_of", language: "fr" }),
      transcript: "Je suis devant la mairie",
      lastPosition: at(CHATEAU_METRO, 2),
      now: NOW,
      gazetteer: gaz,
    });
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("category_nearest_wins");
    expect(r.evidence.feature_id).toBe(MAIRIE_VINCENNES.id);
    expect(r.radius_m).toBeGreaterThanOrEqual(80);
  });

  it("the same report with a stale last position asks instead", () => {
    const r = resolve({
      intent: intent({ landmark_name: "mairie", landmark_category: "town_hall", relation: "in_front_of", language: "fr" }),
      transcript: "Je suis devant la mairie",
      lastPosition: at(CHATEAU_METRO, 25),
      now: NOW,
      gazetteer: gaz,
    });
    expect(r.status).toBe("ambiguous");
    expect(r.question).toMatch(/Quelle mairie/);
  });

  it("movement towards a place keeps the pin and sets heading_to", () => {
    const last = at(CHATEAU_METRO, 1);
    const r = resolve({
      intent: intent({ kind: "movement", landmark_name: "Bérault", relation: "towards" }),
      transcript: "Moving towards Bérault",
      lastPosition: last,
      now: NOW,
      gazetteer: gaz,
    });
    expect(r.status).toBe("resolved");
    expect(r.pin).toEqual({ lat: last.lat, lon: last.lon });
    expect(r.heading_to?.id).toBe(BERAULT.id);
  });

  it("compass relation offsets about 100 m on that bearing", () => {
    const r = resolve({ intent: intent({ landmark_name: "Bérault", relation: "north_of" }), transcript: "north of Bérault", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(r.pin!.lat).toBeGreaterThan(BERAULT.lat);
    expect(distanceM(r.pin!, BERAULT)).toBeGreaterThan(95);
    expect(r.radius_m).toBe(100);
  });
});

describe("name scoring", () => {
  it("word order separates Sainte-Chapelle from Chapelle Sainte-Bernadette", () => {
    expect(nameScore("Sainte-Chapelle", "Sainte-Chapelle de Vincennes")).toBeGreaterThan(nameScore("Sainte-Chapelle", "Chapelle Sainte-Bernadette") + 0.1);
  });
  it("English street word matches French rue", () => {
    const top = searchByName("Fontenay street", gaz)[0];
    expect(top.feature.category).toBe("street");
    expect(top.feature.name.toLowerCase()).toContain("fontenay");
  });
  it("bias terms are capped and lead with stations", () => {
    const b = biasTerms(gaz, 100);
    expect(b.length).toBeLessThanOrEqual(100);
    expect(b).toContain("Bérault");
  });
});
