import { describe, expect, it } from "vitest";
import { readRequest, requestedTrack, requestOnly, splitRequest } from "../lib/geo/requests";
import { kindSaid } from "../lib/geo/tracks";
import { loadRequestEval, scoreRequestCase } from "../lib/evals/requests";

describe("a request for recon, read from the words", () => {
  it("is cut out of a report, so the report reads as it would without it", () => {
    const r = readRequest("unknown vehicle at Mairie de Vincennes, send the drone")!;
    expect(r).toMatchObject({ words: "send the drone", rest: "unknown vehicle at Mairie de Vincennes", n: null });
    // Left in, "drone" came before "vehicle" in the kind words: an unknown drone (21 Nov).
    expect(kindSaid("unknown vehicle at Mairie de Vincennes, send the drone")).toBe("drone");
    expect(kindSaid(r.rest)).toBe("vehicle");
  });

  it("is heard in English, French, Ukrainian and Russian", () => {
    for (const said of [
      "send the drone",
      "send a drone",
      "send our drone",
      "request eyes on",
      "requesting recon",
      "need a drone",
      "get a drone up",
      "can we get eyes on Track 4",
      "Drone requested.",
      "envoyez le drone",
      "on a besoin d'un drone",
      "demande de reconnaissance",
      "потрібна пташка",
      "надішліть дрон",
      "запит на розвідку",
      "нужен дрон",
      "пришлите птичку",
    ])
      expect(readRequest(said), said).not.toBeNull();
  });

  it("is not heard when turned down, or when the words only describe a drone", () => {
    for (const said of [
      "don't send the drone",
      "do not send the drone",
      "no need to send the drone, all clear",
      "pas besoin d'un drone",
      "не потрібен дрон",
      "enemy drone up north",
      "Stand by, getting eyes on.",
      "our drone team is at Bérault",
      "drone 300 metres north of me",
      "friendly drone over the station",
      "I see two drones heading east",
    ])
      expect(readRequest(said), said).toBeNull();
  });

  it("runs to the end of its clause, and keeps a track it names", () => {
    expect(readRequest("send the drone to Track 2, over")).toMatchObject({ words: "send the drone to Track 2", rest: "over", n: 2 });
    expect(readRequest("Enemy drone over the station and send our drone")).toMatchObject({ words: "send our drone", rest: "Enemy drone over the station" });
    expect(readRequest("Two hostile vehicles at the church. Drone requested.")).toMatchObject({ rest: "Two hostile vehicles at the church." });
    expect(readRequest("невідома машина біля мерії, потрібна пташка")).toMatchObject({ rest: "невідома машина біля мерії" });
    expect(readRequest("нужен дрон на трек три")).toMatchObject({ n: 3, rest: "" });
  });

  it("on its own leaves only a track's name or radio words", () => {
    const own = ["Track 2, request eyes on.", "send the drone", "Об'єкт 2, запит на розвідку", "send the drone to Track 2, over"];
    for (const said of own) expect(requestOnly(readRequest(said)!.rest), said).toBe(true);
    expect(requestedTrack(readRequest("Track 2, request eyes on.")!)).toBe(2);
    expect(requestedTrack(readRequest("Об'єкт 2, запит на розвідку")!)).toBe(2);
    expect(requestOnly(readRequest("ALPHA 1 at the church, send the drone")!.rest)).toBe(false);
  });

  it("is split off before the model reads the words", () => {
    expect(splitRequest("unknown vehicle at Mairie de Vincennes, send the drone")).toEqual({
      text: "unknown vehicle at Mairie de Vincennes",
      request: { words: "send the drone", n: null },
      only: false,
    });
    expect(splitRequest("Track 2, request eyes on.")).toEqual({ text: "Track 2.", request: { words: "request eyes on", n: 2 }, only: true });
    expect(splitRequest("I am at the church")).toEqual({ text: "I am at the church", request: null, only: false });
  });
});

describe("the request eval", () => {
  const doc = loadRequestEval();
  it("has unique ids", () => {
    expect(new Set(doc.cases.map((c) => c.id)).size).toBe(doc.cases.length);
  });

  it("passes every case, and reads no request where none was said", () => {
    const scores = doc.cases.map((c) => scoreRequestCase(c));
    expect(scores.filter((s) => s.falseRequest).map((s) => s.id)).toEqual([]);
    expect(scores.filter((s) => !s.pass).map((s) => `${s.id}: ${s.misses.join("; ")}`)).toEqual([]);
  });
});
