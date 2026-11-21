import { describe, expect, it } from "vitest";
import { resolve } from "../lib/geo/resolver";
import { biasTerms, loadGazetteer, nameScore, searchByName } from "../lib/geo/gazetteer";
import { bearingDeg, distanceM, nearestPointOnLines } from "../lib/geo/geo";
import { sanitizeIntent } from "../lib/providers/extractor";
import type { GazetteerFeature, Intent, LastPosition } from "../lib/geo/types";

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
    // 30 m for "at", widened to cover Place Bérault, the small square of the same name above the station.
    expect(r.radius_m).toBeGreaterThanOrEqual(30);
    expect(r.radius_m).toBeLessThanOrEqual(120);
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

  // Mission vincennes-21: "friendly at Vincennes Metro" put the track at the RER station, the only
  // station called exactly "Vincennes"; the metro with that name in it is Château de Vincennes [181].
  describe("a metro word with the whole name of a train station", () => {
    const RER = gaz.find((f) => f.id === "node/1730998187")!;
    const run = (transcript: string, from = MAIRIE_VINCENNES, language: Intent["language"] = "en") =>
      resolve({ intent: intent({ landmark_name: "Vincennes", landmark_category: "metro_station", language }), transcript, lastPosition: at(from), now: NOW, gazetteer: gaz });

    it("is the RER station Vincennes in this gazetteer", () => {
      expect(RER).toMatchObject({ name: "Vincennes", category: "metro_station", subtype: "rail" });
    });

    it("asks between the train station and the metro station with the name", () => {
      const r = run("friendly at Vincennes Metro");
      expect(r.status).toBe("ambiguous");
      expect(r.evidence.rule).toBe("named_metro_or_train");
      expect(r.candidates.map((c) => c.id).sort()).toEqual([CHATEAU_METRO.id, RER.id].sort());
      expect(r.question).toMatch(/^Which station: .*Vincennes.*Vincennes\?$/);
      expect(r.pin).toBeUndefined();
    });

    it("asks even when the speaker stands at the train station", () => {
      expect(run("I'm at Vincennes metro", RER).status).toBe("ambiguous");
    });

    it("asks in French", () => {
      const r = run("Je suis au métro Vincennes", MAIRIE_VINCENNES, "fr");
      expect(r.status).toBe("ambiguous");
      expect(r.question).toMatch(/^Quelle station : /);
    });

    it("still places 'station' and 'RER' at the train station, as before [12]", () => {
      for (const t of ["I'm at Vincennes station", "I'm at the Vincennes RER"]) {
        const r = run(t);
        expect(r.status).toBe("resolved");
        expect(r.evidence.feature_id).toBe(RER.id);
      }
    });

    it("leaves a metro station called by its whole name alone", () => {
      const r = resolve({ intent: intent({ landmark_name: "Bérault", landmark_category: "metro_station" }), transcript: "I'm at Bérault metro", lastPosition: at(MAIRIE_VINCENNES), now: NOW, gazetteer: gaz });
      expect(r.status).toBe("resolved");
      expect(r.evidence.feature_id).toBe(BERAULT.id);
    });
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

  it("movement towards a place moves the pin to the middle of the leg, with a circle spanning it", () => {
    const last = at(CHATEAU_METRO, 1);
    const r = resolve({
      intent: intent({ kind: "movement", landmark_name: "Bérault", relation: "towards" }),
      transcript: "Moving towards Bérault",
      lastPosition: last,
      now: NOW,
      gazetteer: gaz,
    });
    expect(r.status).toBe("resolved");
    expect(r.heading_to?.id).toBe(BERAULT.id);
    const leg = distanceM(last, BERAULT);
    expect(Math.abs(distanceM(r.pin!, last) - leg / 2)).toBeLessThan(2);
    expect(Math.abs(distanceM(r.pin!, BERAULT) - leg / 2)).toBeLessThan(2);
    // the circle reaches both where they were and where they are heading
    expect(Math.abs(r.radius_m! - leg / 2)).toBeLessThanOrEqual(1);
  });

  it("movement with no known starting point gives a target but no pin", () => {
    const r = resolve({ intent: intent({ kind: "movement", landmark_name: "Bérault", relation: "towards" }), transcript: "Moving towards Bérault", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(r.pin).toBeUndefined();
    expect(r.heading_to?.id).toBe(BERAULT.id);
  });

  it("nearest wins from an estimated position only if it survives the uncertainty", () => {
    // Demo steps 3 and 4: "moving towards the town hall" from the station, then "je suis devant la mairie".
    const move = resolve({
      intent: intent({ kind: "movement", landmark_name: null, landmark_category: "town_hall", relation: "towards" }),
      transcript: "Moving towards the town hall",
      lastPosition: at(CHATEAU_METRO, 1),
      now: NOW,
      gazetteer: gaz,
    });
    expect(move.heading_to?.id).toBe(MAIRIE_VINCENNES.id);
    const estimate: LastPosition = { ...move.pin!, ts: NOW, uncertainty_m: move.radius_m };
    const fr = intent({ landmark_name: "mairie", landmark_category: "town_hall", relation: "in_front_of", language: "fr" });
    // From the estimate half way to the mairie, the demo's next step still resolves.
    const next = resolve({ intent: fr, transcript: "Je suis devant la mairie", lastPosition: estimate, now: NOW, gazetteer: gaz });
    expect(next.status).toBe("resolved");
    expect(next.evidence.feature_id).toBe(MAIRIE_VINCENNES.id);

    // The rule itself, from the station (town halls at 347 m and 1,455 m):
    // ±100 m: 447 < 0.4 × 1,355, still clear. ±175 m: 522 > 0.4 × 1,280, so ask.
    const sure = resolve({ intent: fr, transcript: "Je suis devant la mairie", lastPosition: { ...at(CHATEAU_METRO, 1), uncertainty_m: 100 }, now: NOW, gazetteer: gaz });
    expect(sure.status).toBe("resolved");
    expect(sure.evidence.detail).toMatch(/allowing ±100 m/);
    const unsure = resolve({ intent: fr, transcript: "Je suis devant la mairie", lastPosition: { ...at(CHATEAU_METRO, 1), uncertainty_m: 175 }, now: NOW, gazetteer: gaz });
    expect(unsure.status).toBe("ambiguous");
  });

  it("compass relation offsets about 100 m on that bearing", () => {
    const r = resolve({ intent: intent({ landmark_name: "Bérault", relation: "north_of" }), transcript: "north of Bérault", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(r.pin!.lat).toBeGreaterThan(BERAULT.lat);
    expect(distanceM(r.pin!, BERAULT)).toBeGreaterThan(95);
    expect(r.radius_m).toBe(100);
  });
});

describe("stated distances and compass directions", () => {
  const FONTENAY = byName("Rue de Fontenay", "street");
  /** A stated position at the château metro, drawn with a 30 m circle. */
  const start: LastPosition = { ...at(CHATEAU_METRO, 1), radius_m: 30 };
  const move = (p: Partial<Intent>): Intent => intent({ kind: "movement", relation: null, ...p });
  const run = (i: Intent, transcript: string, lastPosition?: LastPosition) => resolve({ intent: i, transcript, lastPosition, now: NOW, gazetteer: gaz });

  it("a stated distance replaces the fixed 100 m offset, and the circle grows with it", () => {
    const r = run(intent({ landmark_name: "Bérault", relation: "north_of", distance_m: 300 }), "300 metres north of Bérault");
    expect(r.status).toBe("resolved");
    expect(r.pin!.lat).toBeGreaterThan(BERAULT.lat);
    expect(Math.abs(distanceM(r.pin!, BERAULT) - 300)).toBeLessThan(3);
    expect(r.radius_m).toBe(120);
    // a place and a distance from it: stated, not an estimate from the last position
    expect(r.estimated).toBeUndefined();
  });

  it("north-east of a place is offset on 45°", () => {
    const r = run(intent({ landmark_name: "Bérault", relation: "north_east_of" }), "north-east of Bérault");
    expect(r.status).toBe("resolved");
    expect(Math.abs(bearingDeg(BERAULT, r.pin!) - 45)).toBeLessThan(2);
    expect(Math.abs(distanceM(r.pin!, BERAULT) - 100)).toBeLessThan(3);
  });

  it("a distance from a place with no side given keeps the pin and widens the circle to take in the ring", () => {
    const r = run(intent({ landmark_name: "Bérault", relation: "near", distance_m: 200 }), "about 200 metres from Bérault");
    expect(r.status).toBe("resolved");
    expect(distanceM(r.pin!, BERAULT)).toBeLessThan(1);
    // 200 m and a quarter more, plus the size of Place Bérault, the square of the same name folded in.
    expect(r.radius_m).toBeGreaterThanOrEqual(250);
    expect(r.radius_m).toBeLessThanOrEqual(300);
  });

  it("a distance and a direction with no place are reckoned from the last position", () => {
    const r = run(move({ distance_m: 300, direction: "north" }), "Moved 300 metres north", start);
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("dead_reckoned");
    expect(r.estimated).toBe(true);
    expect(r.candidates).toEqual([]);
    expect(Math.abs(distanceM(r.pin!, start) - 300)).toBeLessThan(2);
    expect(bearingDeg(start, r.pin!)).toBeLessThan(1);
    // the start's own 30 m plus 0.4 × 300 m for the move
    expect(r.radius_m).toBe(150);
  });

  it("each reckoned leg adds to the circle", () => {
    const first = run(move({ distance_m: 300, direction: "north" }), "Moved 300 metres north", start);
    const from: LastPosition = { ...first.pin!, ts: NOW, radius_m: first.radius_m, uncertainty_m: first.radius_m };
    const second = run(move({ distance_m: 200, direction: "east" }), "Moved 200 metres east", from);
    expect(second.evidence.rule).toBe("dead_reckoned");
    expect(Math.abs(bearingDeg(from, second.pin!) - 90)).toBeLessThan(1);
    expect(second.radius_m).toBe(150 + 80);
  });

  it("«300 metres north of my last position» is the same move", () => {
    const said = run(intent({ relation: "north_of", distance_m: 300 }), "I'm 300 metres north of my last position", start);
    const moved = run(move({ distance_m: 300, direction: "north" }), "Moved 300 metres north", start);
    expect(said.evidence.rule).toBe("dead_reckoned");
    expect(said.pin).toEqual(moved.pin);
  });

  it("a move with no last position asks for a place instead of guessing a start", () => {
    const r = run(move({ distance_m: 300, direction: "north" }), "Moved 300 metres north");
    expect(r.status).toBe("unresolved");
    expect(r.pin).toBeUndefined();
    expect(r.evidence.rule).toBe("dead_reckoning_no_start");
    expect(r.question).toMatch(/where you started/);
    const uk = run(move({ distance_m: 300, direction: "north", language: "uk" }), "Пройшов триста метрів на північ");
    expect(uk.question).toMatch(/звідки/);
  });

  it("a direction with no distance, or a distance with no direction, asks for both", () => {
    for (const i of [move({ direction: "north" }), move({ distance_m: 300 })]) {
      const r = run(i, "Heading north", start);
      expect(r.status).toBe("unresolved");
      expect(r.evidence.rule).toBe("move_incomplete");
      expect(r.question).toMatch(/distance and a compass direction/);
    }
  });

  it("a distance towards a place is that far along the leg, and never past the place", () => {
    const r = run(move({ landmark_name: "Bérault", relation: "towards", distance_m: 200 }), "Moved 200 metres towards Bérault", start);
    expect(r.status).toBe("resolved");
    expect(r.heading_to?.id).toBe(BERAULT.id);
    expect(r.estimated).toBe(true);
    expect(Math.abs(distanceM(r.pin!, start) - 200)).toBeLessThan(2);
    expect(Math.abs(bearingDeg(start, r.pin!) - bearingDeg(start, BERAULT))).toBeLessThan(1);
    // the start's 30 m plus the 50 m minimum for a move (a quarter of 200 m is exactly that)
    expect(r.radius_m).toBe(80);

    const far = run(move({ landmark_name: "Bérault", relation: "towards", distance_m: 5000 }), "Moved 5 kilometres towards Bérault", start);
    expect(distanceM(far.pin!, BERAULT)).toBeLessThan(2);
  });

  it("a move along a named street lands on that street", () => {
    expect(FONTENAY).toBeDefined();
    // A point on rue de Fontenay, which runs east from here and drifts a little south.
    const onStreet: LastPosition = { lat: 48.84856, lon: 2.43249, ts: NOW - 60_000, radius_m: 40 };
    const r = run(move({ landmark_name: "rue de Fontenay", relation: "at", distance_m: 300, direction: "east" }), "Moved 300 metres east on rue de Fontenay", onStreet);
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(FONTENAY.id);
    expect(r.estimated).toBe(true);
    expect(distanceM(r.pin!, nearestPointOnLines(r.pin!, FONTENAY.lines!))).toBeLessThan(1);
    expect(r.pin!.lon).toBeGreaterThan(onStreet.lon);
    expect(Math.abs(distanceM(r.pin!, onStreet) - 300)).toBeLessThan(15);
    expect(r.radius_m).toBe(40 + 120);
  });

  it("a place that cannot be found does not stop a move that states its distance and direction", () => {
    const r = run(move({ landmark_name: "Gare du Nord", distance_m: 300, direction: "north" }), "Moved 300 metres north past Gare du Nord", start);
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("dead_reckoned");
    expect(r.evidence.detail).toMatch(/named_none/);
    // "north of" a place that cannot be found is not a move from the last position: still unresolved
    const of = run(intent({ landmark_name: "Gare du Nord", relation: "north_of", distance_m: 300 }), "300 metres north of Gare du Nord", start);
    expect(of.status).toBe("unresolved");
  });

  it("intent clean-up keeps a sane distance and a compass direction, and drops anything else", () => {
    expect(sanitizeIntent({ kind: "movement", distance_m: 300.4, direction: "north_east" })).toMatchObject({ distance_m: 300, direction: "north_east" });
    for (const distance_m of [-5, 0, 1e9, "300", null]) expect(sanitizeIntent({ distance_m }).distance_m).toBeNull();
    expect(sanitizeIntent({ direction: "left" }).direction).toBeNull();
  });

  it("intent clean-up checks the language against the letters said (decision 104)", () => {
    const lang = (language: string, text: string, hint: string | null = null) => sanitizeIntent({ language }, hint, text).language;
    // What the local 3B model did with English reports in Kyiv
    expect(lang("uk", "I'm at Khreshchatyk.")).toBe("en");
    expect(lang("uk", "Moving towards Saint Sophia Cathedral.")).toBe("en");
    expect(lang("uk", "Je suis devant la mairie.", "fr")).toBe("fr");
    // Speech-to-text heard Ukrainian: trusted, even in Latin letters
    expect(lang("uk", "Ya na Khreshchatyku.", "uk")).toBe("uk");
    // Only Cyrillic letters: Ukrainian, whatever the label
    expect(lang("en", "Я на Хрещатику.")).toBe("uk");
    // Both scripts, or labels that already fit: the model's label stands
    expect(lang("en", "I'm at Хрещатик.")).toBe("en");
    expect(lang("uk", "Рухаюсь до Saint Sophia.")).toBe("uk");
    expect(lang("fr", "Je suis au château.")).toBe("fr");
    // Without the transcript, nothing is checked
    expect(sanitizeIntent({ language: "uk" }).language).toBe("uk");
  });
});

describe("two streets with one name, in two towns", () => {
  // As the gazetteer build writes them: one feature per street, each with its town.
  const street = (town: string, lon0: number): GazetteerFeature => ({
    id: `street/rue-gambetta/${town.toLowerCase()}`,
    name: "Rue Gambetta",
    names: ["Rue Gambetta"],
    category: "street",
    subtype: "residential",
    lat: 48.853,
    lon: lon0 + 0.001,
    bbox: [lon0, 48.853, lon0 + 0.002, 48.853],
    osm_type: "way",
    osm_id: 1,
    lines: [
      [
        [lon0, 48.853],
        [lon0 + 0.002, 48.853],
      ],
    ],
    town,
  });
  const WEST = street("Vincennes", 2.429);
  const EAST = street("Montreuil", 2.457);
  const twoTowns = [WEST, EAST];
  const run = (lang: "en" | "fr", lastPosition?: LastPosition, streets = twoTowns) =>
    resolve({ intent: intent({ landmark_name: "rue Gambetta", landmark_category: "street", language: lang }), transcript: "I'm on rue Gambetta", lastPosition, now: NOW, gazetteer: streets });

  it("with no last position, asks which one and names the towns", () => {
    const r = run("en");
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((c) => c.id).sort()).toEqual([EAST.id, WEST.id].sort());
    expect(r.question).toMatch(/Rue Gambetta \(Vincennes\)/);
    expect(r.question).toMatch(/Rue Gambetta \(Montreuil\)/);
    expect(r.candidates.map((c) => c.town).sort()).toEqual(["Montreuil", "Vincennes"]);
    expect(run("fr").question).toMatch(/^Quelle rue : Rue Gambetta \((Vincennes|Montreuil)\) ou Rue Gambetta/);
  });

  it("a fresh last position on one of them picks it: nearest wins", () => {
    const r = run("en", at({ lat: 48.8535, lon: 2.4295 }, 2));
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(WEST.id);
  });

  it("with no towns to tell them apart, the question gives the distances", () => {
    const r = run("en", undefined, twoTowns.map(({ town, ...f }) => (void town, f)));
    expect(r.status).toBe("ambiguous");
    expect(r.question).toMatch(/Rue Gambetta \(\d+ m\)|Rue Gambetta \(\d\.\d km\)/);
    expect(r.question).not.toMatch(/\(street\)/);
  });

  it("in the real Vincennes gazetteer, «rue Gambetta» is two streets and the question names their towns", () => {
    const gambettas = gaz.filter((f) => f.category === "street" && f.name === "Rue Gambetta");
    expect(gambettas.map((f) => f.town).sort()).toEqual(["Fontenay-sous-Bois", "Montreuil"]);
    const r = resolve({ intent: intent({ landmark_name: "rue Gambetta", landmark_category: "street" }), transcript: "I'm on rue Gambetta", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("ambiguous");
    expect(r.question).toMatch(/Rue Gambetta \(Fontenay-sous-Bois\)/);
    expect(r.question).toMatch(/Rue Gambetta \(Montreuil\)/);
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

describe("Ukrainian reports against the central Kyiv gazetteer", () => {
  const kyiv = loadGazetteer("kyiv");
  const centre = { lat: 50.4501, lon: 30.5234 };
  const k = (n: string, cat: string) => kyiv.find((f) => f.name === n && f.category === cat)!;
  const KHRESHCHATYK_METRO = k("Хрещатик", "metro_station");
  const KHRESHCHATYK_STREET = k("вулиця Хрещатик", "street");
  const SOFIA = k("Софійський собор", "church");
  const uk = (p: Partial<Intent>): Intent => intent({ language: "uk", ...p });
  const run = (i: Intent, transcript: string, lastPosition?: LastPosition) => resolve({ intent: i, transcript, lastPosition, now: NOW, gazetteer: kyiv, areaCentre: centre });

  it("has the features used below", () => {
    expect(KHRESHCHATYK_METRO).toBeDefined();
    expect(KHRESHCHATYK_STREET).toBeDefined();
    expect(SOFIA).toBeDefined();
  });

  it("a name in the locative case matches through its dictionary form", () => {
    const r = run(uk({ landmark_name: "Софійського собору", landmark_name_lemma: "Софійський собор", landmark_category: "church", relation: "near" }), "Я біля Софійського собору");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(SOFIA.id);
  });

  it("still matches an inflected name when no dictionary form is given", () => {
    const r = run(uk({ landmark_name: "Софійського собору", landmark_name_lemma: null, relation: "near" }), "Я біля Софійського собору");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(SOFIA.id);
  });

  it("«на Хрещатику» is a station and a long street: asks in Ukrainian", () => {
    const r = run(uk({ landmark_name: "Хрещатику", landmark_name_lemma: "Хрещатик" }), "Я на Хрещатику");
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.map((c) => c.id).sort()).toEqual([KHRESHCHATYK_METRO.id, KHRESHCHATYK_STREET.id].sort());
    expect(r.question).toMatch(/Хрещатик \(станція\)/);
    expect(r.question).toMatch(/ чи /);
  });

  it("«біля станції метро Хрещатик» resolves to the station, type words inside the name or not", () => {
    for (const name of ["Хрещатик", "станції метро Хрещатик"]) {
      const lemma = name === "Хрещатик" ? "Хрещатик" : "станція метро Хрещатик";
      const r = run(uk({ landmark_name: name, landmark_name_lemma: lemma, landmark_category: "metro_station", relation: "near" }), "Перебуваю біля станції метро Хрещатик");
      expect(r.status).toBe("resolved");
      expect(r.evidence.feature_id).toBe(KHRESHCHATYK_METRO.id);
    }
  });

  it("«на вулиці Хрещатик» resolves to the street", () => {
    const r = run(uk({ landmark_name: "вулиці Хрещатик", landmark_name_lemma: "вулиця Хрещатик", landmark_category: "street" }), "Я на вулиці Хрещатик");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(KHRESHCHATYK_STREET.id);
  });

  it("«на Майдані Незалежності» is a station, a square and a street in one spot: no question, wider circle", () => {
    const r = run(uk({ landmark_name: "Майдані Незалежності", landmark_name_lemma: "Майдан Незалежності" }), "Я на Майдані Незалежності");
    expect(r.status).toBe("resolved");
    expect(r.radius_m).toBeGreaterThan(100);
    expect(r.evidence.detail).toMatch(/folded in/);
  });

  it("«біля церкви» with no last position asks which church, in Ukrainian", () => {
    const r = run(uk({ landmark_name: "церкви", landmark_name_lemma: "церква", landmark_category: null, relation: "near" }), "Я біля церкви");
    expect(r.status).toBe("ambiguous");
    expect(r.question).toMatch(/^Яка церква: /);
    expect(r.candidates.every((c) => c.category === "church")).toBe(true);
  });

  it("an English speaker in Kyiv matches Latin spellings", () => {
    const r = run(intent({ landmark_name: "Khreshchatyk", landmark_category: "metro_station" }), "I'm at Khreshchatyk metro");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(KHRESHCHATYK_METRO.id);
  });

  it("«міста» (of the city) is not read as «міст» (bridge)", () => {
    const r = run(uk({ landmark_name: "центрі міста", landmark_name_lemma: "центр міста" }), "Я в центрі міста");
    expect(r.evidence.rule).not.toMatch(/^category/);
  });

  it("unknown place is unresolved with a Ukrainian prompt", () => {
    const r = run(uk({ landmark_name: "Ейфелевої вежі", landmark_name_lemma: "Ейфелева вежа", relation: "near" }), "Я біля Ейфелевої вежі");
    expect(r.status).toBe("unresolved");
    expect(r.question).toMatch(/Назвіть вулицю/);
  });
});

describe("cemeteries", () => {
  // A real report from the demo mission, 20 Nov: other voices around the speaker, and the
  // extractor read "towards the cemetery" from the Mairie de Vincennes correctly. It was not
  // placed because the gazetteer had no cemeteries.
  const transcript = "and I couldn't cover anything. - Heading towards the cemetery. - Many people came up and I was able to explain them.";
  const fromMairie: LastPosition = { lat: 48.84765, lon: 2.43977, ts: NOW - 60_000, radius_m: 80 };
  const ANCIEN = byName("Cimetière ancien", "cemetery");

  it("the gazetteer has the Vincennes cemetery", () => {
    expect(ANCIEN).toBeDefined();
  });

  it("the logged intent, a generic word as the name, now heads to the nearest cemetery", () => {
    const logged = intent({ kind: "movement", landmark_text: "the cemetery", landmark_name: "cemetery", landmark_name_lemma: "cemetery", landmark_category: "other", relation: "towards", confidence: 0.95 });
    const r = resolve({ intent: logged, transcript, lastPosition: fromMairie, now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(r.heading_to?.id).toBe(ANCIEN.id);
  });

  it("the category in English, French and Ukrainian", () => {
    const cases: [Partial<Intent>, string][] = [
      [{ landmark_text: "the cemetery", landmark_category: "cemetery" }, "Heading towards the cemetery"],
      [{ landmark_text: "le cimetière", landmark_category: "cemetery", language: "fr" }, "Je me dirige vers le cimetière"],
      [{ landmark_text: "кладовища", landmark_category: "cemetery", language: "uk" }, "Рухаюсь до кладовища"],
    ];
    for (const [p, said] of cases) {
      const r = resolve({ intent: intent({ kind: "movement", relation: "towards", ...p }), transcript: said, lastPosition: fromMairie, now: NOW, gazetteer: gaz });
      expect(r.status, said).toBe("resolved");
      expect(r.heading_to?.id, said).toBe(ANCIEN.id);
    }
  });

  it("with no last position, asks which cemetery", () => {
    const r = resolve({ intent: intent({ landmark_text: "the cemetery", landmark_category: "cemetery" }), transcript: "I'm at the cemetery", now: NOW, gazetteer: gaz });
    expect(r.status).not.toBe("resolved");
  });
});

describe("roads in the Bois closed to cars", () => {
  // OpenStreetMap maps them as tracks and paths. Until 21 Nov the build left those out: Route de
  // la Dame Blanche was its 102 m open to cars, not its 418 m, and Route du Donjon was not there.
  const DAME_BLANCHE = gaz.find((f) => f.id === "street/route-de-la-dame-blanche")!;
  const onStreet = (name: string) => intent({ landmark_text: name, landmark_name: name, landmark_category: "street", relation: "at" });

  it("a road that is only a track is in the gazetteer", () => {
    const r = resolve({ intent: onStreet("Route du Donjon"), transcript: "I'm on Route du Donjon", now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
  });

  it("from the car-free end, the pin is where the speaker is, not 300 m away", () => {
    expect(DAME_BLANCHE.subtype).toBe("residential");
    const eastEnd: LastPosition = { lat: 48.8449, lon: 2.446, ts: NOW - 60_000 };
    const r = resolve({ intent: onStreet("Route de la Dame Blanche"), transcript: "I'm on Route de la Dame Blanche", lastPosition: eastEnd, now: NOW, gazetteer: gaz });
    expect(r.status).toBe("resolved");
    expect(distanceM(r.pin!, eastEnd)).toBeLessThan(30);
  });
});

describe("a move along a street", () => {
  const NOGENT = gaz.find((f) => f.id === "street/avenue-de-nogent")!;
  // The answer that put ALPHA 1 at Château de Vincennes station, mission vincennes-4.
  const station: LastPosition = { lat: 48.84458, lon: 2.43891, ts: NOW - 30_000, radius_m: 30 };
  const said = (relation: Intent["relation"], text: string) =>
    resolve({
      intent: intent({ kind: "movement", landmark_text: "Avenue de Nogent", landmark_name: "Avenue de Nogent", landmark_name_lemma: "Avenue de Nogent", landmark_category: "street", relation }),
      transcript: text,
      lastPosition: station,
      now: NOW,
      gazetteer: gaz,
    });

  it("puts 'moving down Avenue de Nogent' on the avenue, as an estimate", () => {
    const r = said(null, "Moving down Avenue de Nogent.");
    expect(r.status).toBe("resolved");
    expect(r.evidence.feature_id).toBe(NOGENT.id);
    expect(r.heading_to).toBeUndefined();
    expect(r.estimated).toBe(true);
    expect(distanceM(r.pin!, nearestPointOnLines(r.pin!, NOGENT.lines!))).toBeLessThan(1);
    // The station's own 30 m, and the step onto the avenue.
    const step = Math.round(distanceM(station, r.pin!));
    expect(r.radius_m).toBe(Math.max(50, 30 + step));
  });

  it("keeps 'moving towards Avenue de Nogent' on the way to it", () => {
    const r = said("towards", "Moving towards Avenue de Nogent.");
    expect(r.heading_to?.id).toBe(NOGENT.id);
  });

  it("with no last position, puts the speaker anywhere on the street", () => {
    const r = resolve({
      intent: intent({ kind: "movement", landmark_name: "Avenue de Nogent", landmark_category: "street", relation: null }),
      transcript: "Moving down Avenue de Nogent.",
      now: NOW,
      gazetteer: gaz,
    });
    expect(r.status).toBe("resolved");
    expect(r.heading_to).toBeUndefined();
    expect(r.radius_m).toBe(400);
  });

  it("widens the circle by a distance said with no direction", () => {
    const r = said(null, "Moving down Avenue de Nogent.");
    const step = Math.round(distanceM(station, r.pin!));
    const withDistance = resolve({
      intent: intent({ kind: "movement", landmark_name: "Avenue de Nogent", landmark_category: "street", relation: null, distance_m: 200 }),
      transcript: "Moved 200 metres down Avenue de Nogent.",
      lastPosition: station,
      now: NOW,
      gazetteer: gaz,
    });
    // Either way along the street: the station's 30 m, the step onto it, and 200 m with a quarter's slack.
    expect(withDistance.radius_m).toBe(30 + step + 250);
    expect(withDistance.pin).toEqual(r.pin);
  });
});
