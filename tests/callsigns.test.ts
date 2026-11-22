import { describe, expect, it } from "vitest";
import { matchCallsign, type CallsignMatch } from "../lib/geo/callsigns";
import { loadCallsignEval, scoreCallsignCase } from "../lib/evals/callsigns";

const ROSTER = ["ALPHA 1", "ALPHA 2", "BRAVO 2", "CHARLIE 3", "СОКІЛ", "ГРІМ"];
const m = (text: string, roster = ROSTER) => matchCallsign(text, roster);
const unit = (r: CallsignMatch) => (r.kind === "unit" ? `${r.callsign} ${r.how}` : r.kind === "ask" ? `ask ${r.candidates.join(" / ")}` : `unassigned ${r.read ?? "-"}`);

describe("call signs read from the words", () => {
  it("reads the sender at the start, in any spelling, and keeps the words as heard", () => {
    expect(m("Alpha 1, at the château.")).toMatchObject({ kind: "unit", callsign: "ALPHA 1", how: "exact", heard: "Alpha 1" });
    expect(unit(m("Alfa one, at the château."))).toBe("ALPHA 1 exact");
    expect(unit(m("Alpha-1, at the church."))).toBe("ALPHA 1 exact");
    expect(unit(m("Alpha1 at the church."))).toBe("ALPHA 1 exact");
    expect(unit(m("Alpha un, je suis devant la mairie."))).toBe("ALPHA 1 exact");
    expect(unit(m("Альфа один, біля школи."))).toBe("ALPHA 1 exact");
    expect(unit(m("Чарлі-3, біля мосту."))).toBe("CHARLIE 3 exact");
  });

  it("reads it after the command post's call sign or \"this is\", and skips the command post", () => {
    expect(unit(m("Base, this is Alpha 2, at the church."))).toBe("ALPHA 2 exact");
    expect(unit(m("Base, Charlie 3, at the château."))).toBe("CHARLIE 3 exact");
    expect(unit(m("PC de Charlie trois, à l'église."))).toBe("CHARLIE 3 exact");
    expect(unit(m("Базо, я Грім, біля мосту."))).toBe("ГРІМ exact");
    expect(unit(m("Hello all stations, this is Bravo 2, at the cemetery."))).toBe("BRAVO 2 exact");
    expect(unit(m("Bravo 2, this is Alpha 1, I'm at the cemetery."))).toBe("ALPHA 1 exact");
    expect(m("Base, at the church.")).toMatchObject({ kind: "unassigned", read: null });
  });

  it("takes the command post's own call signs from the options", () => {
    expect(unit(matchCallsign("Lysk, this is Alpha 2.", ROSTER, { station: ["LYSK"] }))).toBe("ALPHA 2 exact");
    expect(unit(matchCallsign("Lysk, this is Alpha 2.", ROSTER))).toBe("ALPHA 2 exact"); // "this is" alone finds it
    // Not known as the command post, so "Alpha 2" is not read as following it. It is the last
    // thing said, though, so the operator is asked whether it was ALPHA 2 [237].
    expect(matchCallsign("Lysk, Alpha 2.", ROSTER)).toMatchObject({ kind: "ask", candidates: ["ALPHA 2"], signoff: true });
    expect(unit(matchCallsign("Lysk, Alpha 2, at the church.", ROSTER))).toBe("unassigned -");
  });

  it("treats the command post speaking as no report from a unit", () => {
    expect(unit(m("Alpha 1, this is base, report your position."))).toBe("unassigned -");
    expect(unit(m("Соколе, я База, доповідай."))).toBe("unassigned -");
  });

  it("does not take a call sign later in the message as the sender", () => {
    expect(unit(m("ALPHA 1: BRAVO 2 is at the church."))).toBe("ALPHA 1 exact");
    expect(unit(m("I'm with Bravo 2 at the church."))).toBe("unassigned -");
    expect(unit(m("Бачу Сокола біля школи."))).toBe("unassigned -");
  });

  it("reads Ukrainian call signs in any case", () => {
    expect(unit(m("Від Сокола: стою біля школи."))).toBe("СОКІЛ exact");
    expect(unit(m("Базі від Грома: на позиції біля мосту."))).toBe("ГРІМ exact");
    expect(unit(m("Сокіл на зв'язку."))).toBe("СОКІЛ exact");
    expect(unit(m("Орла, біля мосту.", ["ОРЕЛ"]))).toBe("ОРЕЛ exact"); // the е drops
  });

  it("takes a near match only when one roster entry is close", () => {
    expect(unit(m("Alpha won, at the château."))).toBe("ALPHA 1 near");
    expect(unit(m("Charlie tree at the church."))).toBe("CHARLIE 3 near");
    expect(unit(m("Charly 3, at the station."))).toBe("CHARLIE 3 near");
    expect(unit(m("Sokil, near the school."))).toBe("СОКІЛ near");
    expect(unit(m("Сокил, біля школи."))).toBe("СОКІЛ near");
    expect(unit(m("Charlie, at the château."))).toBe("CHARLIE 3 near");
    expect(unit(m("Alpa won, at the château."))).toBe("unassigned -"); // the word and the number both guessed
  });

  it("asks when the number is in doubt, never picks", () => {
    expect(unit(m("Alpha, at the château."))).toBe("ask ALPHA 1 / ALPHA 2");
    expect(unit(m("Alpha to base, at the station."))).toBe("ask ALPHA 1 / ALPHA 2");
    expect(unit(m("Alpha for, at the church."))).toBe("ask ALPHA 1 / ALPHA 2");
    // "to" may be "two": CHARLIE 2 is not on the roster, so CHARLIE 3 is asked about, not moved.
    expect(unit(m("Charlie to base, at the station."))).toBe("ask CHARLIE 3");
    // Both readings of "to" give the only Bravo.
    expect(unit(m("Bravo to base, I'm at the town hall."))).toBe("BRAVO 2 near");
  });

  it("leaves a call sign that is not on the roster unassigned, with what was read", () => {
    expect(m("Delta 4, checking in.")).toMatchObject({ kind: "unassigned", read: "DELTA 4", heard: "Delta 4" });
    expect(unit(m("Charlie 1, checking in at the station."))).toBe("unassigned CHARLIE 1");
    expect(unit(m("Fox trot four, checking in."))).toBe("unassigned FOXTROT 4");
    expect(unit(m("Я Беркут, біля школи."))).toBe("unassigned БЕРКУТ");
    expect(unit(m("Golf course, I'm next to the clubhouse."))).toBe("unassigned -");
  });

  it("does not read a number after the call sign as part of it", () => {
    expect(unit(m("Alpha one, two hundred metres east of the church."))).toBe("ALPHA 1 exact");
    expect(unit(m("Сокіл, два кілометри на північ від школи."))).toBe("СОКІЛ exact");
    expect(unit(m("Alpha one two, at the church.", ["ALPHA 12"]))).toBe("ALPHA 12 exact");
  });

  it("reads a call sign at the end as a sign-off to confirm, when nothing at the start named a sender [237]", () => {
    // Always a question with the one unit it may be: it may also be who is spoken to.
    expect(m("At the town hall, Alpha 1.")).toMatchObject({ kind: "ask", candidates: ["ALPHA 1"], heard: "Alpha 1", signoff: true });
    expect(unit(m("Moving towards the town hall, Alpha 1, over."))).toBe("ask ALPHA 1");
    expect(unit(m("Track 1 is hostile. Charlie 3 out."))).toBe("ask CHARLIE 3");
    expect(unit(m("Send the drone to Track 2, Alpha 1, over"))).toBe("ask ALPHA 1");
    expect(unit(m("Moving towards the town hall - Alpha 1 - over"))).toBe("ask ALPHA 1");
    expect(unit(m("At the church, Charlie 3. Thank you."))).toBe("ask CHARLIE 3"); // Whisper's words for trailing silence
    expect(unit(m("At the church, Alpha won, over and out."))).toBe("ask ALPHA 1");
    expect(unit(m("Contact, bearing 060, 300 metres, from Alpha 2, standing by."))).toBe("ask ALPHA 2");
    expect(unit(m("Base, at the town hall, Alpha 1."))).toBe("ask ALPHA 1");
    expect(unit(m("Біля школи, Сокіл, прийом."))).toBe("ask СОКІЛ");
    // The same question for an order that ends with who it is for: the reader cannot tell, a person can.
    expect(unit(m("Push up to the station and hold the north entrance, Bravo 2."))).toBe("ask BRAVO 2");
    expect(unit(m("Go ahead, Alpha 1."))).toBe("ask ALPHA 1");
    // "this is" within the first words is the start rule's: a unit, not a question.
    expect(unit(m("At the town hall, this is Bravo 2."))).toBe("BRAVO 2 exact");
    // A call sign at the start is not a sign-off.
    expect(m("Alpha 1, at the town hall.")).toMatchObject({ kind: "unit", callsign: "ALPHA 1" });
  });

  it("does not take a call sign at the end that the sentence is about", () => {
    for (const said of [
      "I'm at the church with Bravo 2.",
      "Two vehicles near Charlie 3",
      "I can see Alpha 2, over",
      "Moving to join Bravo 2.",
      "Holding at checkpoint Charlie 3",
      "Je suis avec Bravo 2",
      "Стою біля Сокола",
    ])
      expect(unit(m(said)), said).toBe("unassigned -");
    // No pause written before it: part of the sentence, whatever the words are. A list of words
    // that tie a call sign in can never be complete ("linking up alongside Bravo 2").
    for (const said of ["Track 1 is hostile Charlie 3 out", "Send the drone to Track 2 Alpha 1 over", "Linking up alongside Bravo 2.", "Cannot raise Charlie 3, over.", "About 200 metres from Alpha 2, over."])
      expect(unit(m(said)), said).toBe("unassigned -");
    // A question, or words that speak to someone: the call sign is who is spoken to.
    expect(unit(m("Are you still at the church, Bravo 2? Over."))).toBe("unassigned -");
    expect(unit(m("Say again your position, Alpha 1."))).toBe("unassigned -");
    // The command post signs off: it is speaking to the unit named first.
    expect(m("Alpha 1, move to the station and report, Base out.")).toMatchObject({ kind: "unassigned", station: true });
    expect(unit(m("Alpha 1 to Base, over."))).toBe("ALPHA 1 exact");
    // The number has to be said: "Charlie" alone may be a checkpoint or a phase line.
    expect(unit(m("Holding short, Charlie."))).toBe("unassigned -");
    expect(unit(m("At the château, Alpha."))).toBe("unassigned -");
    // The start wins, whatever the end says.
    expect(unit(m("Alpha 1, I see a vehicle, Bravo 2 out."))).toBe("ALPHA 1 exact");
    expect(unit(m("Bravo 2 is at the church, Alpha 1."))).toBe("BRAVO 2 exact");
    // Not the last thing said.
    expect(unit(m("At the town hall, Alpha 1, moving north."))).toBe("unassigned -");
    // Not on the roster.
    expect(unit(m("At the town hall, Delta 4, out."))).toBe("unassigned -");
  });

  it("names only roster entries: an empty roster never gives a unit", () => {
    for (const text of ["Alpha 1, at the château.", "Сокіл, біля школи.", "Base, this is Bravo 2."]) {
      expect(m(text, []).kind).toBe("unassigned");
    }
  });
});

describe("the call-sign eval", () => {
  const doc = loadCallsignEval();
  it("has unique ids and only roster entries in its answers", () => {
    expect(new Set(doc.cases.map((c) => c.id)).size).toBe(doc.cases.length);
    for (const c of doc.cases) for (const s of [c.expect.callsign, ...(c.expect.candidates ?? [])]) if (s) expect(doc.roster).toContain(s);
  });

  it("passes every case, and never names a wrong unit", () => {
    const scores = doc.cases.map((c) => scoreCallsignCase(c, doc.roster));
    expect(scores.filter((s) => s.wrongUnit).map((s) => s.id)).toEqual([]);
    expect(scores.filter((s) => !s.pass).map((s) => `${s.id}: ${s.misses.join("; ")}`)).toEqual([]);
  });
});
