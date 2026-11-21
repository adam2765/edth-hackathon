import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGazetteer } from "../lib/geo/gazetteer";
import { checkCasesFile, compareReplies, scoreReply, toReplyBaseline, type ReplyCase, type ReplyCasesFile, type ReplyResult } from "../lib/evals/replies";
import { replyMessage, replyPrompt, sanitizeReading } from "../lib/providers/replies";

const file = JSON.parse(readFileSync(join(__dirname, "../evals/replies.cases.json"), "utf8")) as ReplyCasesFile;

describe("reply eval cases", () => {
  it("are sound: known questions and kinds, a choice for every pick and only for a pick", () => {
    expect(checkCasesFile(file)).toEqual([]);
  });

  it("offer choices that are real places in their area", () => {
    for (const [key, q] of Object.entries(file.questions)) {
      const ids = new Set(loadGazetteer(q.area).map((f) => f.id));
      for (const c of q.choices) {
        if (c.id.startsWith("crossing/")) continue; // worked out from the street lines, not in the gazetteer
        expect(ids.has(c.id), `${key}: ${c.id}`).toBe(true);
      }
    }
  });

  it("do not reuse the prompt's example names", () => {
    const examples = ["Oakfield", "Mill Bridge", "Stone Bridge", "Elm Street"];
    for (const n of examples) expect(replyPrompt()).toContain(n);
    for (const c of file.cases) for (const n of examples) expect(c.reply.includes(n), c.id).toBe(false);
  });
});

describe("scoring a reply", () => {
  const trackQ = file.questions["cemetery-track-en"];
  const selfQ = file.questions["chateau-en"];
  const c = (expect: ReplyCase["expect"]): ReplyCase => ({ id: "x", question: "q", tags: ["fast"], reply: "x", expect });

  it("passes the right choice and marks a wrong one as costly", () => {
    expect(scoreReply(c({ kind: "pick", choice: 2 }), selfQ, { kind: "pick", choice: 2 })).toEqual({ pass: true, costly: null });
    expect(scoreReply(c({ kind: "pick", choice: 2 }), selfQ, { kind: "pick", choice: 1 })).toEqual({ pass: false, costly: "wrong_pick" });
    expect(scoreReply(c({ kind: "new_report" }), selfQ, { kind: "pick", choice: 2 })).toEqual({ pass: false, costly: "wrong_pick" });
  });

  it("marks a swapped subject as costly only for a question about a track", () => {
    expect(scoreReply(c({ kind: "new_report" }), trackQ, { kind: "rephrase", choice: null })).toEqual({ pass: false, costly: "wrong_subject" });
    expect(scoreReply(c({ kind: "rephrase" }), trackQ, { kind: "new_report", choice: null })).toEqual({ pass: false, costly: "wrong_subject" });
    expect(scoreReply(c({ kind: "new_report" }), selfQ, { kind: "rephrase", choice: null })).toEqual({ pass: false, costly: null });
  });

  it("marks a disregard nobody said as costly, and any other miss as plain", () => {
    expect(scoreReply(c({ kind: "dont_know" }), selfQ, { kind: "disregard", choice: null })).toEqual({ pass: false, costly: "wrong_disregard" });
    expect(scoreReply(c({ kind: "repeat" }), selfQ, { kind: "unclear", choice: null })).toEqual({ pass: false, costly: null });
    expect(scoreReply(c({ kind: ["unclear", "repeat"] }), selfQ, { kind: "repeat", choice: null })).toEqual({ pass: true, costly: null });
  });
});

describe("the model's reading", () => {
  it("keeps a choice only for a pick that was offered", () => {
    expect(sanitizeReading({ kind: "pick", choice: 2 }, 2)).toEqual({ kind: "pick", choice: 2 });
    expect(sanitizeReading({ kind: "pick", choice: 3 }, 2)).toEqual({ kind: "unclear", choice: null });
    expect(sanitizeReading({ kind: "pick", choice: null }, 2)).toEqual({ kind: "unclear", choice: null });
    expect(sanitizeReading({ kind: "none", choice: 1 }, 2)).toEqual({ kind: "none", choice: null });
    expect(sanitizeReading({ kind: "maybe" }, 2)).toEqual({ kind: "unclear", choice: null });
  });

  it("is asked with who the question is about and the numbered choices", () => {
    const m = replyMessage("the north one", file.questions["cemetery-track-en"]);
    expect(m).toContain("Question about: Track 4 (enemy patrol), something the speaker reported seeing");
    expect(m).toContain("1. Cimetière Nord de Saint-Mandé (cemetery, 632 m)");
    expect(m).toContain("2. Cimetière Sud de Saint-Mandé (cemetery, 906 m)");
    expect(m.endsWith('Reply: "the north one"')).toBe(true);
  });
});

describe("the reply baseline", () => {
  const r = (id: string, round: number, pass: boolean): ReplyResult => ({ id, round, kind: pass ? "none" : "unclear", choice: null, pass, costly: null, ms: 1 });

  it("keeps the majority verdict and lists regressions and improvements", () => {
    const base = toReplyBaseline({ reader: "m", prompt_id: "p", at: "t", repeat: 3 }, [r("a", 1, true), r("a", 2, true), r("a", 3, false), r("b", 1, false)]);
    expect(base.cases).toEqual({ a: { pass: true, costly: null }, b: { pass: false, costly: null } });
    const run = toReplyBaseline({ reader: "m", prompt_id: "p", at: "t", repeat: 1 }, [r("a", 1, false), r("b", 1, true), r("c", 1, true)]);
    expect(compareReplies(base, run)).toEqual({ regressions: ["a"], newCostly: [], improvements: ["b"], unseen: ["c"] });
  });
});
