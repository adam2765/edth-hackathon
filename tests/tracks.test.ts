import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ms from "milsymbol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { distanceM } from "../lib/geo/geo";
import { resolve } from "../lib/geo/resolver";
import { AFFILIATIONS, describeTrack, TRACK_KINDS, trackSymbolCode } from "../lib/geo/trackKinds";
import { affiliationSaid, compassChecked, compassWordsSaid, contactSaid, kindSaid, readSubject, resolveReport, TRACK_ON_LINE_M, trackNumberSaid, withTrackNumber } from "../lib/geo/tracks";
import type { Intent, LastPosition } from "../lib/geo/types";
import { sanitizeIntent, systemPrompt } from "../lib/providers/extractor";
import { foldLog, TRACK_OLD_AFTER_MS } from "../lib/reports/fold";
import { createMission, joinMission, recordAnswer, reportContext, saveReport, type ReportInput } from "../lib/reports/record";
import { getStore } from "../lib/reports/store";
import type { StartPoint } from "../lib/reports/types";

const gaz = loadGazetteer();
const NOW = Date.parse("2026-11-21T09:00:00Z");
const byName = (n: string, cat: string) => gaz.find((f) => f.name === n && f.category === cat)!;
const BERAULT = byName("Bérault", "metro_station");
const CASTLE = byName("Château de Vincennes", "castle");
const MAIRIE = byName("Mairie de Vincennes", "town_hall");

function intent(p: Partial<Intent>): Intent {
  return { kind: "position", landmark_text: null, landmark_name: null, landmark_category: null, relation: null, language: "en", confidence: 0.9, subject: "self", ...p };
}
/** The model's reading of a report about a track. */
const track = (p: Partial<Intent>): Intent => intent({ subject: "track", ...p });
const at = (f: { lat: number; lon: number }, radius_m = 30): LastPosition => ({ lat: f.lat, lon: f.lon, ts: NOW - 60_000, radius_m });
const base = { now: NOW, gazetteer: gaz, observer: "ALPHA 1" };

describe("what the words say about a track", () => {
  it("nothing is hostile unless a hostile word was said", () => {
    expect(affiliationSaid("Enemy vehicle in front of the town hall")).toBe("hostile");
    expect(affiliationSaid("Vehicle in front of the town hall")).toBeNull();
    expect(affiliationSaid("Unknown vehicle near the bridge")).toBeNull();
    expect(affiliationSaid("L'ennemi est devant la mairie")).toBe("hostile");
    expect(affiliationSaid("Ворожий танк біля церкви")).toBe("hostile");
    expect(affiliationSaid("Бачу ворога біля мосту")).toBe("hostile");
  });

  it("a suspect is a suspicious thing, or a doubted hostile one; doubt alone says nothing", () => {
    expect(affiliationSaid("Two suspicious vehicles near the church")).toBe("suspect");
    expect(affiliationSaid("Possible enemy mortar behind the castle")).toBe("suspect");
    expect(affiliationSaid("Possible vehicle near the bridge")).toBeNull();
    expect(affiliationSaid("Véhicule suspect devant la mairie")).toBe("suspect");
    expect(affiliationSaid("Підозріла машина біля церкви")).toBe("suspect");
  });

  it("friendly and civilian have their own words", () => {
    expect(affiliationSaid("Our drone team is at Bérault")).toBe("friendly");
    expect(affiliationSaid("Friendly vehicle on the bridge")).toBe("friendly");
    expect(affiliationSaid("Civilian car near the cemetery")).toBe("neutral");
    expect(affiliationSaid("Цивільна машина біля парку")).toBe("neutral");
  });

  it("the kind comes from a type word, the more particular one first", () => {
    expect(kindSaid("Enemy tank near the church")).toBe("armour");
    expect(kindSaid("Our drone team is at Bérault")).toBe("drone_team");
    expect(kindSaid("I see a drone north of me")).toBe("drone");
    expect(kindSaid("Three soldiers on the bridge")).toBe("people");
    expect(kindSaid("Camion ennemi devant la mairie")).toBe("vehicle");
    expect(kindSaid("Ворожий міномет за церквою")).toBe("mortar");
    expect(kindSaid("Засіб РЕБ біля вокзалу")).toBe("jammer");
    expect(kindSaid("I am at the town hall")).toBeNull();
  });

  it("a track is named by its number, in three languages", () => {
    expect(trackNumberSaid("Track 3 moved to the station")).toBe(3);
    expect(trackNumberSaid("track three is hostile")).toBe(3);
    expect(trackNumberSaid("Piste numéro deux est près du château")).toBe(2);
    expect(trackNumberSaid("Об'єкт 4 тепер на Хрещатику")).toBe(4);
    expect(trackNumberSaid("Об’єкт три біля церкви")).toBe(3);
    // A track on the ground is not a track on the map.
    expect(trackNumberSaid("I'm on the dirt track behind the castle")).toBeNull();
    expect(trackNumberSaid("Je suis sur la piste cyclable")).toBeNull();
  });
});

describe("who the report is about", () => {
  it("the speaker, as before, when nothing says otherwise", () => {
    expect(readSubject(intent({ landmark_name: "Bérault" }), "I'm at Bérault").subject).toBe("self");
    // A model that knows nothing of tracks leaves the field out.
    expect(readSubject({ ...intent({}), subject: undefined }, "Moving towards the town hall").subject).toBe("self");
  });

  it("a track when the model says so and the words name a kind of thing or whose it is", () => {
    expect(readSubject(track({ track_kind: "vehicle" }), "Enemy vehicle at Bérault")).toMatchObject({ subject: "track", affiliation: "hostile", kind: "vehicle", ref: null });
    expect(readSubject(track({}), "I see a drone north of me")).toMatchObject({ subject: "track", affiliation: null, kind: "drone" });
  });

  it("a track named by its number is a track whatever the model said", () => {
    expect(readSubject(intent({ kind: "movement", relation: "towards", landmark_name: "Bérault" }), "Track 3 moved to Bérault")).toMatchObject({ subject: "track", ref: 3 });
  });

  it("unclear when the model and the words disagree", () => {
    // Read as a track, but no word names a thing: "I see the church" is where the speaker is.
    expect(readSubject(track({ landmark_category: "church" }), "I can see the church").subject).toBe("unclear");
    // Read as the speaker, but a hostile word was said: a friendly marker must not land on it.
    expect(readSubject(intent({ landmark_category: "church" }), "Enemy at the church").subject).toBe("unclear");
  });

  it("unclear when the model reads the speaker but the words name a thing and whose it is", () => {
    // Hosted Mistral read this as where the speaker is, 21 November.
    expect(readSubject(intent({ landmark_name: "Vincennes", landmark_category: "metro_station" }), "Our drone team is at Vincennes station.").subject).toBe("unclear");
    expect(readSubject(intent({ landmark_category: "cemetery", relation: "near" }), "Civilian car near the cemetery").subject).toBe("unclear");
    // A friendly word with no kind of thing is still the speaker: "our" is said about places too.
    expect(readSubject(intent({ landmark_category: "church", relation: "near" }), "We are at our rally point near the church").subject).toBe("self");
    // A kind of thing with no word for whose it is, read as the speaker, stays the speaker.
    expect(readSubject(intent({ landmark_category: "church", relation: "next_to" }), "I'm next to the car park by the church").subject).toBe("self");
  });

  it("the model does not decide whose a track is", () => {
    const r = readSubject(track({ track_kind: "vehicle" }), "Vehicle at Bérault");
    expect(r).toMatchObject({ subject: "track", affiliation: null });
  });
});

describe("a contact is something seen", () => {
  // Hosted Mistral's reading of this report in mission vincennes-21, 21 November: the speaker moving east.
  const heard = "Unknown Contact, two blocks east.";
  const modelRead = intent({ kind: "movement", relation: "towards", direction: "east", distance_m: null, confidence: 0.8 });

  it("as the first word, or next to whose it is, doubt, unknown, new or a count", () => {
    for (const said of [heard, "Contact, two blocks east", "Enemy contact behind the castle", "Possible contact near the bridge", "Two contacts near the church", "Contact ennemi devant la mairie", "Nouveau contact au nord", "Невідомий контакт біля мосту", "BRAVO 2, contact front"]) {
      expect(contactSaid(said), said).toBe(true);
    }
  });

  it("not when contact means keeping in touch", () => {
    for (const said of ["Lost contact with BRAVO 2", "I'm in contact with the base", "Pas de contact radio", "Moving to the contact point at Bérault", "I am at Bérault"]) {
      expect(contactSaid(said), said).toBe(false);
    }
  });

  it("is a track whatever the model said, unknown unless a word says whose", () => {
    expect(readSubject(modelRead, heard)).toMatchObject({ subject: "track", affiliation: null, kind: null, ref: null });
    expect(readSubject(intent({ landmark_category: "church" }), "Enemy contact at the church")).toMatchObject({ subject: "track", affiliation: "hostile" });
    expect(readSubject(intent({ landmark_name: "Bérault" }), "Lost contact with BRAVO 2 at Bérault").subject).toBe("self");
  });

  it('"two blocks" is no distance (decision 51): at the castle no street runs east to count along, so the app asks how far in the way said, and the speaker stays put', () => {
    const r = resolveReport({ ...base, intent: modelRead, transcript: heard, lastPosition: at(CASTLE) });
    expect(r).toMatchObject({ status: "unresolved", evidence: { rule: "blocks_uncounted" }, question: "How far east is it? Or name a place near it." });
    expect(r.track).toMatchObject({ affiliation: null, kind: null });
    expect(r.track?.placement).toBeUndefined();
    expect(r.pin).toBeUndefined();
    const fr = resolveReport({ ...base, intent: intent({ kind: "movement", direction: "east", language: "fr" }), transcript: "Contact ennemi à l'est", lastPosition: at(CASTLE) });
    expect(fr.question).toBe("À quelle distance à l'est ? Ou donnez un lieu proche.");
  });

  it("with a distance it is placed from the observer, and the speaker stays put", () => {
    const last = at(CASTLE);
    const r = resolveReport({ ...base, intent: { ...modelRead, distance_m: 200 }, transcript: "Unknown contact, 200 metres east", lastPosition: last });
    expect(r.status).toBe("resolved");
    expect(r.pin).toBeUndefined();
    expect(r.track).toMatchObject({ affiliation: null, label: "200 m east of ALPHA 1" });
    expect(Math.round(distanceM(last, r.track!.placement!.pin!))).toBe(200);
    expect(r.track!.placement!.pin!.lon).toBeGreaterThan(last.lon);
  });
});

describe("placing a track", () => {
  it("a report about the speaker resolves exactly as before", () => {
    const input = { ...base, intent: intent({ landmark_name: "Bérault", relation: "at" }), transcript: "I'm at Bérault", lastPosition: at(CASTLE) };
    expect(resolveReport(input)).toEqual(resolve(input));
  });

  it("by a place: the pin goes to the track, never to the speaker", () => {
    const r = resolveReport({ ...base, intent: track({ landmark_name: "Bérault", relation: "at", track_kind: "vehicle", track_text: "enemy vehicle" }), transcript: "Enemy vehicle at Bérault", lastPosition: at(CASTLE) });
    expect(r.status).toBe("resolved");
    expect(r.pin).toBeUndefined();
    expect(r.radius_m).toBeUndefined();
    expect(r.evidence.feature_id).toBe(BERAULT.id);
    expect(r.track).toMatchObject({ n: null, opened: true, affiliation: "hostile", kind: "vehicle", text: "enemy vehicle", label: "Bérault" });
    expect(distanceM(r.track!.placement!.pin!, BERAULT)).toBeLessThan(5);
    for (const c of r.candidates) {
      expect(c.placement).toEqual({});
      expect(c.track_placement?.pin).toBeDefined();
    }
  });

  it("from the observer: dead reckoning from where they are, as an estimate", () => {
    const last = at(CASTLE, 30);
    const r = resolveReport({ ...base, intent: track({ distance_m: 300, direction: "north", track_kind: "drone" }), transcript: "I see a drone about 300 metres north of me", lastPosition: last });
    expect(r.status).toBe("resolved");
    expect(r.evidence.rule).toBe("dead_reckoned");
    const pl = r.track!.placement!;
    expect(Math.round(distanceM(last, pl.pin!))).toBe(300);
    expect(pl.pin!.lat).toBeGreaterThan(last.lat);
    // The observer's own circle, plus 0.4 of the distance for "north".
    expect(pl.radius_m).toBe(30 + 120);
    expect(pl.estimated).toBe(true);
    expect(r.track).toMatchObject({ affiliation: null, kind: "drone", label: "300 m north of ALPHA 1" });
    expect(r.pin).toBeUndefined();
  });

  it('"north of me" as a relation is the same as a direction', () => {
    const r = resolveReport({ ...base, intent: track({ distance_m: 200, relation: "east_of" }), transcript: "Enemy soldiers 200 metres east of my position", lastPosition: at(CASTLE) });
    expect(r.track?.label).toBe("200 m east of ALPHA 1");
    expect(r.track?.placement?.pin?.lon).toBeGreaterThan(CASTLE.lon);
  });

  it("asks when the observer has no position, or only a direction was said", () => {
    const noStart = resolveReport({ ...base, intent: track({ distance_m: 300, direction: "north" }), transcript: "Drone 300 metres north of me", lastPosition: null });
    expect(noStart).toMatchObject({ status: "unresolved", evidence: { rule: "dead_reckoning_no_start" } });
    expect(noStart.question).toMatch(/don't know where you are/);
    const noDistance = resolveReport({ ...base, intent: track({ direction: "east" }), transcript: "Enemy vehicle to the east", lastPosition: at(CASTLE) });
    expect(noDistance).toMatchObject({ status: "unresolved", evidence: { rule: "move_incomplete" } });
    expect(noDistance.question).toMatch(/How far/);
    const nothing = resolveReport({ ...base, intent: track({ kind: "other" }), transcript: "I see an enemy vehicle", lastPosition: at(CASTLE) });
    expect(nothing).toMatchObject({ status: "unresolved", evidence: { rule: "track_no_place" } });
    for (const r of [noStart, noDistance, nothing]) expect(r.track?.placement).toBeUndefined();
  });

  it("asks which place when two could be meant, with the choices placing the track", () => {
    const r = resolveReport({ ...base, intent: track({ landmark_category: "town_hall", relation: "in_front_of", track_kind: "vehicle" }), transcript: "Enemy vehicle in front of the town hall", lastPosition: at(CASTLE) });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.length).toBeGreaterThan(1);
    expect(r.candidates.some((c) => c.id === MAIRIE.id)).toBe(true);
    for (const c of r.candidates) {
      expect(c.placement).toEqual({});
      expect(c.track_placement?.pin).toBeDefined();
    }
    expect(r.track).toMatchObject({ affiliation: "hostile", opened: true });
  });

  it('"moved to" is where it is; "heading towards" is not, so the app asks', () => {
    const moved = resolveReport({ ...base, intent: track({ kind: "movement", relation: "towards", landmark_name: "Bérault", track_ref: 1 }), transcript: "Track 1 moved to Bérault", lastPosition: at(CASTLE), tracks: [{ n: 1 }] });
    expect(moved.status).toBe("resolved");
    expect(moved.track).toMatchObject({ n: 1, opened: false, label: "Bérault" });
    expect(moved.track?.placement?.estimated).toBeUndefined();
    const heading = resolveReport({ ...base, intent: track({ kind: "movement", relation: "towards", landmark_name: "Bérault", track_ref: 1 }), transcript: "Track 1 is heading towards Bérault", lastPosition: at(CASTLE), tracks: [{ n: 1 }] });
    expect(heading).toMatchObject({ status: "unresolved", evidence: { rule: "track_towards_only" } });
  });

  it("a number the mission does not have is not opened by naming it", () => {
    const r = resolveReport({ ...base, intent: track({ landmark_name: "Bérault", track_ref: 9 }), transcript: "Track 9 is at Bérault", lastPosition: at(CASTLE), tracks: [{ n: 1 }] });
    expect(r).toMatchObject({ status: "unresolved", question: "There is no Track 9 in this mission.", evidence: { rule: "track_unknown" } });
  });

  it("a named track with no place only changes what it is", () => {
    const r = resolveReport({ ...base, intent: track({ kind: "other", track_ref: 2 }), transcript: "Track 2 is hostile", lastPosition: at(CASTLE), tracks: [{ n: 2 }] });
    expect(r).toMatchObject({ status: "resolved", evidence: { rule: "track_described" }, track: { n: 2, opened: false, affiliation: "hostile" } });
    expect(r.track?.placement).toBeUndefined();
  });

  it("asks whose position it is when the model and the words disagree", () => {
    const r = resolveReport({ ...base, intent: intent({ landmark_category: "church", relation: "at" }), transcript: "Enemy at the church", lastPosition: at(CASTLE) });
    expect(r).toMatchObject({ status: "unresolved", evidence: { rule: "subject_unclear" } });
    expect(r.pin).toBeUndefined();
    expect(r.track).toBeUndefined();
    expect(r.question).toMatch(/where you are, or something you see/);
  });

  it("a track on a street is somewhere along it, not at the point nearest the observer", () => {
    const r = resolveReport({ ...base, intent: track({ landmark_name: "Avenue de Nogent", landmark_category: "street", relation: "at", track_kind: "vehicle" }), transcript: "Unknown vehicle on Avenue de Nogent", lastPosition: at(CASTLE) });
    expect(r.status).toBe("resolved");
    expect(r.track?.placement?.radius_m).toBeGreaterThanOrEqual(TRACK_ON_LINE_M);
  });
});

describe("the compass words: where it is, and the way it is going", () => {
  const roles = (text: string) => compassWordsSaid(text).map((w) => `${w.dir}:${w.role}`);

  it("a distance before the word puts the thing there; a verb of moving is the way it goes", () => {
    expect(roles("Hostile drone, 1 km east, heading north.")).toEqual(["east:where", "north:going"]);
    expect(roles("Two vehicles heading south, 500 metres west.")).toEqual(["south:going", "west:where"]);
    expect(roles("Unknown contact moving north-east, about 300 metres north.")).toEqual(["north_east:going", "north:where"]);
    expect(roles("Enemy vehicle north of the church")).toEqual(["north:where"]);
    expect(roles("Convoy northbound")).toEqual(["north:going"]);
    expect(roles("Enemy vehicle to the east")).toEqual(["east:unclear"]);
  });

  it("the speaker's own move and where a thing came from say neither", () => {
    expect(roles("I'm moving north, enemy drone 1 km east")).toEqual(["north:self", "east:where"]);
    expect(roles("Drone coming from the north")).toEqual(["north:from"]);
  });

  it("French and Ukrainian; French \"est\" is a compass word only as one", () => {
    expect(roles("Drone ennemi à un kilomètre à l'est, il se dirige vers le nord.")).toEqual(["east:where", "north:going"]);
    expect(roles("Drone ennemi à 300 mètres au nord-est")).toEqual(["north_east:where"]);
    expect(roles("Le drone est à 300 mètres")).toEqual([]);
    expect(roles("Drone à 300 mètres vers l'est")).toEqual(["east:where"]);
    expect(roles("Ворожий дрон за кілометр на схід, летить на північ.")).toEqual(["east:where", "north:going"]);
    expect(roles("Бачу дрон за триста метрів на північний схід від мене")).toEqual(["north_east:where"]);
  });

  const last = at(CASTLE, 30);
  const place = (heard: string, read: Partial<Intent>) => {
    const i = track({ track_kind: "drone", ...read });
    return withTrackNumber(resolveReport({ ...base, intent: i, transcript: heard, lastPosition: last }), 7, i, heard);
  };
  const east = (r: ReturnType<typeof place>) => {
    const pin = r.track!.placement!.pin!;
    expect(Math.round(distanceM(last, pin))).toBe(1000);
    expect(pin.lon).toBeGreaterThan(last.lon);
    expect(Math.abs(pin.lat - last.lat)).toBeLessThan(1e-6);
  };

  it("swapped by the model: the pin goes the way the words say, with the heading they say", () => {
    // ministral-3:3b, 21 November: east read as the heading and north as where the drone is.
    const r = place("Hostile drone one kilometer east, moving north.", { distance_m: 1000, direction: "north", track_heading: "east" });
    expect(r.status).toBe("resolved");
    east(r);
    expect(r.track).toMatchObject({ heading: "north", label: "1000 m east of ALPHA 1", say: "Track 7, hostile drone, 1000 metres east of you." });
    expect(r.evidence.detail).toMatch(/compass words say moving north \(read east\), east of the observer \(read north\)/);
    const fr = place("Drone ennemi à un kilomètre à l'est, il se dirige vers le nord.", { distance_m: 1000, direction: "north", track_heading: "east", language: "fr" });
    east(fr);
    expect(fr.track).toMatchObject({ heading: "north", say: "Piste 7, drone hostile, 1000 mètres à l'est de vous." });
    const uk = place("Ворожий дрон за кілометр на схід, летить на північ.", { distance_m: 1000, direction: "north", track_heading: "east", language: "uk" });
    east(uk);
    expect(uk.track?.heading).toBe("north");
  });

  it("merged by the model: the words split them again", () => {
    // ministral-3:3b, 21 November: "south" and "west" made one south-west; "north-east" taken as where it is.
    const merged = resolveReport({ ...base, intent: track({ track_kind: "vehicle", track_count: 2, distance_m: 500, direction: "south_west", track_heading: "south" }), transcript: "Two vehicles heading south, 500 metres west.", lastPosition: last });
    expect(merged.track?.placement?.pin?.lon).toBeLessThan(last.lon);
    expect(merged.track).toMatchObject({ heading: "south", label: "500 m west of ALPHA 1" });
    const family = resolveReport({ ...base, intent: track({ distance_m: 300, direction: "north_east" }), transcript: "Unknown contact moving north-east, about 300 metres north.", lastPosition: last });
    expect(family.track).toMatchObject({ heading: "north_east", label: "300 m north of ALPHA 1" });
  });

  it("dropped by the model: the words give back where it is", () => {
    // ministral-3:3b left out "east", and the app asked how far and which way.
    const r = place("Hostile drone, 1 km east, heading north.", { distance_m: 1000, direction: null, track_heading: "north" });
    expect(r.status).toBe("resolved");
    east(r);
    expect(r.track?.heading).toBe("north");
  });

  it("no heading that was not said: one compass word is not both", () => {
    // "Hostel drone 1 km east", 21 November: the model copied "east" into the heading too.
    const r = place("Hostel drone 1 km east", { distance_m: 1000, direction: "east", track_heading: "east" });
    east(r);
    expect(r.track?.heading).toBeNull();
    const unclear = place("Enemy drone to the east", { direction: "east", track_heading: "east" });
    expect(unclear.track?.heading).toBeNull();
    expect(unclear.question).toMatch(/How far east/);
    const self = place("I'm moving north, enemy drone 1 km east", { distance_m: 1000, direction: "east", track_heading: "north" });
    east(self);
    expect(self.track?.heading).toBeNull();
  });

  it("only the way it is going: the app asks where it is, and keeps the heading", () => {
    const r = place("Hostile drone heading north", { direction: "north", track_heading: "north" });
    expect(r).toMatchObject({ status: "unresolved", evidence: { rule: "track_no_place" }, track: { heading: "north" } });
    expect(r.question).toMatch(/^Where is it\?/);
    const far = place("Hostile drone 1 km away, heading north", { distance_m: 1000, direction: "north", track_heading: "north" });
    expect(far).toMatchObject({ status: "unresolved", evidence: { rule: "move_incomplete" }, track: { heading: "north" } });
    expect(far.question).toBe("Which way is it from you? Give a compass direction, or name a place near it.");
  });

  it("with a place, the heading comes from the words, never from where it is", () => {
    const moving = resolveReport({ ...base, intent: track({ landmark_name: "Bérault", relation: "at", track_kind: "vehicle" }), transcript: "Two vehicles at Bérault, moving east", lastPosition: last });
    expect(moving.track?.heading).toBe("east");
    const north = resolveReport({ ...base, intent: track({ landmark_name: "Bérault", relation: "north_of", track_heading: "north" }), transcript: "Enemy vehicle north of Bérault", lastPosition: last });
    expect(north.track?.heading).toBeNull();
  });

  it("two different ways for the same role, or no compass word found: no change made from the words", () => {
    const two = compassChecked(track({ distance_m: 1000, direction: "east" }), "Drone 1 km east, 2 km north", false);
    expect(two.intent.direction).toBeNull();
    const none = track({ distance_m: 1000, direction: "north_east", track_heading: "south" });
    expect(compassChecked(none, "Drone 1 km NE, going S", false)).toEqual({ intent: none, why: null });
    const same = track({ distance_m: 300, direction: "north" });
    expect(compassChecked(same, "I see a drone about 300 metres north of me", false)).toEqual({ intent: same, why: null });
  });

  it("a bearing or a clock direction says where it is, not the way it moves [246]", () => {
    // The stage line: the offline model read bearing 060 as "moving east" as well, every time.
    const read = track({ distance_m: 300, direction: "north_east", track_heading: "east", track_kind: "vehicle" });
    const line = "unknown vehicle, bearing 060, 300 metres, send the drone";
    const checked = compassChecked(read, line, false);
    expect(checked.intent.track_heading).toBeNull();
    expect(checked.intent.direction).toBe("north_east");
    expect(checked.why).toMatch(/moving not said \(read east\)/);
    expect(compassChecked(track({ distance_m: 200, track_heading: "south" }), "contact at 3 o'clock, 200 metres", false).intent.track_heading).toBeNull();
    // Placed 300 m on 060 from the observer, with no heading on the track.
    const r = resolveReport({ ...base, intent: read, transcript: line, lastPosition: last });
    expect(r).toMatchObject({ status: "resolved", evidence: { rule: "dead_reckoned" }, track: { heading: null } });
    // A compass word after a verb of moving is still a heading, bearing or not.
    const moving = compassChecked(track({ distance_m: 300, direction: "north_east", track_heading: "east" }), "unknown vehicle, bearing 060, 300 metres, moving east", false);
    expect(moving.intent.track_heading).toBe("east");
    // No angle and no compass word found: the model's reading stands, as before.
    const kept = track({ distance_m: 1000, track_heading: "south" });
    expect(compassChecked(kept, "Drone 1 km away, going S", false).intent.track_heading).toBe("south");
  });
});

describe("what the app says back", () => {
  const placed = (lang: Intent["language"], transcript: string, p: Partial<Intent>) => {
    const i = track({ language: lang, landmark_name: "Bérault", relation: "at", ...p });
    return withTrackNumber(resolveReport({ ...base, intent: i, transcript, lastPosition: at(CASTLE), tracks: [{ n: 3 }] }), 3, i, transcript);
  };

  it("the number, what it is and where, in the speaker's language", () => {
    expect(placed("en", "Enemy vehicle at Bérault", { track_kind: "vehicle" }).track?.say).toBe("Track 3, hostile vehicle, Bérault.");
    expect(placed("fr", "Véhicule ennemi à Bérault", { track_kind: "vehicle" }).track?.say).toBe("Piste 3, véhicule hostile, Bérault.");
    expect(placed("uk", "Ворожа машина на Bérault", { track_kind: "vehicle" }).track?.say).toBe("Об'єкт 3, ворожа машина, Bérault.");
    // Nothing said about whose it is: unknown, said out loud.
    expect(placed("en", "Two vehicles at Bérault", { track_kind: "vehicle", track_count: 2 }).track?.say).toBe("Track 3, unknown vehicle, count 2, Bérault.");
    expect(placed("fr", "Équipe drone amie à Bérault", {}).track?.say).toBe("Piste 3, équipe drone amie, Bérault.");
  });

  it("a later report on a named track says where it is now", () => {
    expect(placed("en", "Track 3 moved to Bérault", { track_ref: 3 }).track?.say).toBe("Track 3, now Bérault.");
    expect(placed("fr", "Piste 3 est maintenant à Bérault", { track_ref: 3 }).track?.say).toBe("Piste 3, maintenant Bérault.");
  });

  it("from the observer: the distance and direction from them", () => {
    const i = track({ distance_m: 300, direction: "north_east", language: "uk" });
    const heard = "Бачу дрон за триста метрів на північний схід від мене";
    const r = withTrackNumber(resolveReport({ ...base, intent: i, transcript: heard, lastPosition: at(CASTLE) }), 4, i, heard);
    expect(r.track?.say).toBe("Об'єкт 4, невідомий дрон, 300 метрів на північний схід від вас.");
  });

  it("a question starts with the number; with no mission the words say there is no number", () => {
    const i = track({ landmark_category: "town_hall", relation: "in_front_of" });
    const heard = "Enemy vehicle in front of the town hall";
    const ask = resolveReport({ ...base, intent: i, transcript: heard, lastPosition: at(CASTLE) });
    expect(withTrackNumber(ask, 5, i, heard).question).toMatch(/^Track 5\. Which town hall: /);
    expect(withTrackNumber(ask, 5, i, heard).track?.say).toBeUndefined();
    const j = track({ landmark_name: "Bérault", relation: "at" });
    const unsaved = withTrackNumber(resolveReport({ ...base, intent: j, transcript: "Enemy vehicle at Bérault", lastPosition: at(CASTLE) }), null, j, "Enemy vehicle at Bérault");
    expect(unsaved.track).toMatchObject({ n: null, say: "Hostile vehicle, Bérault. Not numbered: no mission." });
  });
});

describe("the extractor's track fields", () => {
  it("the model writes one `track` object; the intent carries it flat", () => {
    const i = sanitizeIntent({ kind: "position", track: { ref: 3, kind: "vehicle", count: 2, text: " two trucks ", heading: "east" } });
    expect(i).toMatchObject({ subject: "track", track_ref: 3, track_kind: "vehicle", track_count: 2, track_text: "two trucks", track_heading: "east" });
  });

  it("no track, or nonsense, is a report about the speaker", () => {
    for (const t of [null, undefined, "vehicle", 3]) expect(sanitizeIntent({ kind: "position", track: t })).toMatchObject({ subject: "self", track_ref: null, track_kind: null, track_count: null, track_text: null, track_heading: null });
    expect(sanitizeIntent({ track: { ref: -1, kind: "spaceship", count: 2.5, text: "", heading: "left" } })).toMatchObject({ subject: "track", track_ref: null, track_kind: null, track_count: null, track_text: null, track_heading: null });
  });

  it("every example in the prompt ends with a track, null or an object", () => {
    const examples = systemPrompt().split("\n").filter((l) => l.includes("→ {"));
    expect(examples.length).toBeGreaterThan(15);
    for (const line of examples) {
      const parsed = JSON.parse(line.slice(line.indexOf("→ ") + 2));
      expect(parsed).toHaveProperty("track");
      // The model never writes whose a track is: that is read from the words in code.
      if (parsed.track) expect(Object.keys(parsed.track)).toEqual(["ref", "kind", "count", "text", "heading"]);
    }
  });
});

describe("a track's symbol", () => {
  it("every kind and affiliation has a standard code milsymbol can draw", () => {
    for (const a of AFFILIATIONS) {
      for (const k of TRACK_KINDS) {
        const code = trackSymbolCode(a, k);
        expect(code).toHaveLength(15);
        expect(new ms.Symbol(code, { size: 24 }).isValid(), `${a} ${k}: ${code}`).toBe(true);
      }
    }
  });

  it("the frame says whose it is; a civilian thing never gets a military icon", () => {
    expect(trackSymbolCode("hostile", "armour")).toBe("SHGPUCA--------");
    expect(trackSymbolCode("suspect", "vehicle")).toBe("SSGPEV---------");
    expect(trackSymbolCode("unknown", "other")).toBe("SUGP-----------");
    expect(trackSymbolCode("friendly", "drone_team")).toBe("SFGPUCVU-------");
    expect(trackSymbolCode("hostile", "drone")).toBe("SHAPMFQ--------");
    expect(trackSymbolCode("neutral", "vehicle")).toBe("SNGPEVC--------");
    expect(trackSymbolCode("neutral", "people")).toBe("SNGP-----------");
    expect(trackSymbolCode("neutral", "mortar")).toBe("SNGP-----------");
  });

  it("is described in words too, because the icon is small", () => {
    expect(describeTrack({ affiliation: "hostile", kind: "vehicle", count: 2 })).toBe("hostile vehicle ×2");
    expect(describeTrack({ affiliation: "unknown", kind: "other", count: null })).toBe("unknown");
    expect(describeTrack({ affiliation: "neutral", kind: "vehicle", count: 1 })).toBe("civilian vehicle");
  });
});

describe("tracks in a mission", () => {
  const T0 = Date.UTC(2026, 10, 21, 9, 0, 0);
  const t = (s: number) => T0 + s * 1000;
  const START: StartPoint = { id: CASTLE.id, name: "Château de Vincennes", category: "castle", lat: CASTLE.lat, lon: CASTLE.lon, radius_m: 300 };
  let dir: string;
  let session = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tracks-"));
    process.env.REPORT_STORE = "file";
    process.env.REPORT_STORE_DIR = dir;
    expect(getStore().kind).toBe("file");
    const m = await createMission({ area: "vincennes", name: "Recon", start: START }, t(0));
    if (!m.ok) throw new Error("no mission");
    session = m.mission.code;
    await joinMission(session, "ALPHA 1", "phone-aaaa", t(5));
    await joinMission(session, "BRAVO 2", "phone-bbbb", t(6));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** One report through the same steps as POST /api/report, without the model. */
  async function send(callsign: string, s: number, transcript: string, i: Intent, extra: Partial<ReportInput> = {}) {
    const ctx = await reportContext(session, callsign, { area: "vincennes", lastPosition: null }, t(s));
    if (!ctx.ok) throw new Error(ctx.error);
    const resolution = resolveReport({ intent: i, transcript, lastPosition: ctx.lastPosition, now: t(s), gazetteer: gaz, tracks: ctx.tracks, observer: callsign });
    const saved = await saveReport({ session, callsign, seq: null, clientTs: null, area: "vincennes", transcript, language: "en", intent: i, resolution, lastPosition: ctx.lastPosition, timings_ms: { stt: 0, extract: 0, resolve: 0, total: 0 }, ...extra }, t(s));
    if (!saved) throw new Error("not saved");
    return saved;
  }
  const state = async (upTo?: number) => foldLog((await getStore().list(session)).entries, upTo);

  it("the first sighting opens Track 1 and says the number back; the speaker does not move", async () => {
    const saved = await send("ALPHA 1", 10, "Enemy vehicle at Bérault", track({ landmark_name: "Bérault", relation: "at", track_kind: "vehicle", track_text: "enemy vehicle" }));
    expect(saved.resolution.track).toMatchObject({ n: 1, say: "Track 1, hostile vehicle, Bérault." });
    const s = await state();
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0]).toMatchObject({ n: 1, affiliation: "hostile", kind: "vehicle", text: "enemy vehicle", seenBy: "ALPHA 1", openedBy: "ALPHA 1", seenTs: t(10), position: { label: "Bérault", radius_m: 40 }, pendingReport: null, trail: [] });
    // The observer is still at the start point, and the line of sight starts there.
    const alpha = s.units.find((u) => u.callsign === "ALPHA 1")!;
    expect(alpha.position).toMatchObject({ lat: START.lat, lon: START.lon, estimated: true });
    expect(alpha.atStart).toBe(true);
    expect(alpha.lastHeard).toBe(t(10));
    expect(s.tracks[0].from).toEqual({ lat: START.lat, lon: START.lon, radius_m: 300 });
    expect(s.feed[0]).toMatchObject({ track: 1, status: "resolved", outcome: "Marked Track 1: hostile vehicle at Bérault (±40 m)", position: { label: "Bérault" } });
  });

  it("another unit's sighting gets the next number; with no word for it, it is unknown", async () => {
    const saved = await send("BRAVO 2", 20, "I see a drone about 300 metres north of me", track({ distance_m: 300, direction: "north", track_kind: "drone" }));
    expect(saved.resolution.track).toMatchObject({ n: 2, say: "Track 2, unknown drone, 300 metres north of you." });
    const two = (await state()).tracks[1];
    expect(two).toMatchObject({ n: 2, affiliation: "unknown", kind: "drone", seenBy: "BRAVO 2", position: { label: "300 m north of BRAVO 2", estimated: true } });
  });

  it("a report sent twice opens one track, not two", async () => {
    const i = track({ landmark_name: "Bérault", relation: "near", track_kind: "people", track_count: 3 });
    const first = await send("ALPHA 1", 30, "Three soldiers near Bérault", i, { seq: 7, clientTs: t(29) });
    const again = await send("ALPHA 1", 31, "Three soldiers near Bérault", i, { seq: 7, clientTs: t(29) });
    expect(first.resolution.track?.n).toBe(3);
    expect(again).toEqual(first);
    expect((await state()).tracks.map((x) => x.n)).toEqual([1, 2, 3]);
  });

  it("naming a track moves it and leaves a trail; saying what it is changes that and nothing else", async () => {
    const moved = await send("BRAVO 2", 40, "Track 1 moved to the castle", track({ landmark_category: "castle", relation: "at", track_ref: 1 }));
    expect(moved.resolution.track).toMatchObject({ n: 1, opened: false, say: "Track 1, now Château de Vincennes." });
    let one = (await state()).tracks[0];
    expect(one).toMatchObject({ n: 1, affiliation: "hostile", kind: "vehicle", seenBy: "BRAVO 2", seenTs: t(40), openedBy: "ALPHA 1", position: { label: "Château de Vincennes" } });
    expect(one.trail).toHaveLength(1);
    expect(distanceM(one.trail[0], BERAULT)).toBeLessThan(5);

    const said = await send("ALPHA 1", 50, "Track 2 is hostile", track({ kind: "other", track_ref: 2 }));
    expect(said.resolution.track?.say).toBe("Track 2, hostile.");
    const s = await state();
    expect(s.tracks[1]).toMatchObject({ n: 2, affiliation: "hostile", kind: "drone", seenBy: "ALPHA 1", position: { label: "300 m north of BRAVO 2" } });
    expect(s.tracks[1].trail).toHaveLength(0);
    expect(s.feed[0].outcome).toBe("Track 2 is now: hostile drone");
    one = s.tracks[0];
    expect(one.seenTs).toBe(t(40));
  });

  it("a question about a track is answered for the track; the speaker stays put", async () => {
    const asked = await send("ALPHA 1", 60, "Suspicious vehicle in front of the town hall", track({ landmark_category: "town_hall", relation: "in_front_of", track_kind: "vehicle" }));
    expect(asked.resolution.status).toBe("ambiguous");
    expect(asked.resolution.question).toMatch(/^Track 4\. Which town hall/);
    let s = await state();
    expect(s.tracks[3]).toMatchObject({ n: 4, affiliation: "suspect", position: null, pendingReport: asked.id });
    // The observer owes the answer.
    expect(s.units.find((u) => u.callsign === "ALPHA 1")?.pending?.reportId).toBe(asked.id);

    const answer = await recordAnswer(session, asked.id, MAIRIE.id, t(65));
    expect(answer).toMatchObject({ ok: true, entry: { position: null, track: { n: 4, position: { label: "Mairie de Vincennes" } } } });
    s = await state();
    expect(s.tracks[3]).toMatchObject({ n: 4, pendingReport: null, position: { label: "Mairie de Vincennes" } });
    const alpha = s.units.find((u) => u.callsign === "ALPHA 1")!;
    expect(alpha.pending).toBeNull();
    expect(alpha.position).toMatchObject({ lat: START.lat, lon: START.lon });
    expect(s.feed.find((f) => f.id === asked.id)).toMatchObject({ track: 4, outcome: expect.stringMatching(/^Chose Mairie de Vincennes\. Track 4 at Mairie de Vincennes/) });
  });

  it("a report that could not be placed opens no track", async () => {
    const saved = await send("ALPHA 1", 70, "Enemy vehicle to the east", track({ direction: "east", track_kind: "vehicle" }));
    expect(saved.resolution).toMatchObject({ status: "unresolved", track: { n: null } });
    const s = await state();
    expect(s.tracks).toHaveLength(4);
    expect(s.feed[0]).toMatchObject({ track: null, status: "unresolved" });
  });

  it("a replay shows the tracks as they were, and a track goes old, not silent", async () => {
    expect((await state(t(15))).tracks.map((x) => x.n)).toEqual([1]);
    expect((await state(t(15))).tracks[0].position?.label).toBe("Bérault");
    expect((await state(t(9))).tracks).toHaveLength(0);
    expect(TRACK_OLD_AFTER_MS).toBeGreaterThan(3 * 60_000);
  });

  it("the mission's tracks are handed to the resolver, so a number can be checked", async () => {
    const ctx = await reportContext(session, "ALPHA 1", { area: "vincennes", lastPosition: null }, t(80));
    expect(ctx).toMatchObject({ ok: true, tracks: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] });
  });
});
