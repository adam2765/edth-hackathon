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
    expect(unit(matchCallsign("Lysk, Alpha 2.", ROSTER))).toBe("unassigned -");
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
