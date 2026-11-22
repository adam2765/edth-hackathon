/**
 * What waits on the operator, oldest first, as one list [239]: questions with choices, questions
 * with none ("How far east is it?"), radio reports held until the operator says whose they are, and
 * requests for recon. On a radio net the command post is the only place a question is answered
 * [208], so nothing that needs a person is left in the history feed. Pure; safe on the client.
 */
import type { FeedItem, RequestState, SessionState } from "./fold";
import type { HeldEntry } from "./types";

export type Decision =
  /** A report the resolver could not place without asking which of its choices. */
  | { kind: "question"; id: string; ts: number; callsign: string; colour: string; item: FeedItem }
  /** A report that could not be placed, with a question and no choices: asked by radio, or closed. */
  | { kind: "prompt"; id: string; ts: number; callsign: string; colour: string; item: FeedItem }
  /** A radio report waiting for the operator to say whose it is [203]. */
  | { kind: "held"; id: string; ts: number; callsign: null; colour: null; held: HeldEntry }
  /** A unit's request for a drone to look at a track [234]. */
  | { kind: "request"; id: string; ts: number; callsign: string; colour: string; request: RequestState };

/** Still waiting for a person: not answered or closed, not overtaken by the unit's next report, not ended. */
function waiting(f: FeedItem): boolean {
  return f.kind === "report" && !f.answer && !f.expired && !f.overtaken && !!f.question;
}

export function decisionsOf(s: SessionState): Decision[] {
  const out: Decision[] = [];
  for (const f of s.feed) {
    if (!waiting(f)) continue;
    const base = { id: f.id, ts: f.ts, callsign: f.callsign, colour: f.colour, item: f };
    out.push(f.status === "ambiguous" && f.candidates.length ? { kind: "question", ...base } : { kind: "prompt", ...base });
  }
  for (const h of s.held) out.push({ kind: "held", id: h.id, ts: h.ts, callsign: null, colour: null, held: h });
  for (const r of s.requests) out.push({ kind: "request", id: r.id, ts: r.ts, callsign: r.callsign, colour: r.colour, request: r });
  return out.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

/**
 * One thing the operator can do with a decision. `choice` answers a question (null: none of the
 * choices); `close` closes a question with no choices; `held` settles a held radio report.
 */
export type DecisionOption =
  | { kind: "choice"; choice: string | null; name: string }
  | { kind: "close" }
  | { kind: "held"; action: "assign" | "add" | "dismiss"; callsign: string | null };

/**
 * What a decision offers, for the buttons and the keys: the numbered options (keys 1 to 9) and the
 * one that drops it (key N): none of these, close, dismiss. A request for recon has its own
 * controls [234], so it offers none here.
 */
export function optionsOf(d: Decision, roster: string[]): { numbered: DecisionOption[]; drop: DecisionOption | null } {
  switch (d.kind) {
    case "question":
      return { numbered: d.item.candidates.map((c) => ({ kind: "choice", choice: c.id, name: c.name })), drop: { kind: "choice", choice: null, name: "" } };
    case "prompt":
      return { numbered: [], drop: { kind: "close" } };
    case "held": {
      const h = d.held;
      const onRoster = (c: string) => roster.includes(c);
      // The units it may be from, then the call sign heard when it is not on the roster yet.
      const give = [...new Set([...h.candidates, ...(h.read ? [h.read] : [])])].filter(onRoster);
      const numbered: DecisionOption[] = give.map((c) => ({ kind: "held", action: "assign", callsign: c }));
      if (h.read && !onRoster(h.read)) numbered.push({ kind: "held", action: "add", callsign: h.read });
      return { numbered, drop: { kind: "held", action: "dismiss", callsign: null } };
    }
    case "request":
      return { numbered: [], drop: null };
  }
}
