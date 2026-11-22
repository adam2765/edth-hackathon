/**
 * Reading a transcript for one unit: the model extracts the intent, the resolver places it against
 * the gazetteer from the unit's last position. The report endpoint runs it on every report; the
 * command post's Unassigned tray runs it again when the operator gives a held radio report to a
 * unit [203], since where "200 metres north of me" is depends on who said it. Server only.
 */
import type { Area } from "@/lib/geo/areas";
import { loadGazetteer } from "@/lib/geo/gazetteer";
import { affiliationSaid, kindSaid, resolveReport, trackNumberSaid, type KnownTrack } from "@/lib/geo/tracks";
import { readPick, type PickHow } from "@/lib/geo/replies";
import type { Candidate, Intent, LastPosition, Resolution } from "@/lib/geo/types";
import { readVoices } from "@/lib/geo/voices";
import { getExtractor } from "@/lib/providers/extractor";
import { foldLog } from "./fold";
import { withoutClosing } from "./radio";
import type { LogEntry } from "./types";

/** The resolution saved with a call that was only a request: nothing to place, and no question [234]. */
export const REQUEST_ONLY: Resolution = {
  status: "unresolved",
  candidates: [],
  evidence: { rule: "request_only", detail: "only a request for recon; nothing to place" },
};

/**
 * The resolution sent back when the words were taken as an answer to the unit's open question
 * [246]: nothing is placed by them, and no new question is asked. The command post confirms.
 */
export const ANSWER_HEARD: Resolution = {
  status: "unresolved",
  candidates: [],
  evidence: { rule: "answer_heard", detail: "heard as an answer to the unit's open question; the command post confirms the choice" },
};

/**
 * A few words that answer a unit's open question, and are not a report [246]: "two", "the metro
 * station". Null when the unit has no open question with choices, or the words are not one of the
 * closed forms `readPick` reads: they are then read as a report, as before. `words` are the words
 * after the sender's call sign.
 */
export function answerHeard(entries: LogEntry[], callsign: string, words: string, now: number): { report_id: string; candidate: Candidate; n: number; how: PickHow } | null {
  const pending = foldLog(entries, now).units.find((u) => u.callsign === callsign)?.pending;
  if (!pending) return null;
  // Without "over", "à vous" or «прийом», whether or not a call sign came first.
  const pick = readPick(withoutClosing(words), pending.candidates);
  return pick ? { report_id: pending.reportId, candidate: pending.candidates[pick.choice - 1], n: pick.choice, how: pick.how } : null;
}

export interface ReadInput {
  area: Area;
  /** The language speech-to-text heard, a hint for the model. */
  sttLanguage: string | null;
  /** The language the device is set to; the question comes back in it. */
  pinned: "en" | "fr" | "uk" | null;
  lastPosition: LastPosition | null;
  now: number;
  tracks: KnownTrack[];
  /** The unit that said it: the observer of a track it reports. */
  callsign: string;
}

export interface ReadResult {
  intent: Intent;
  resolution: Resolution;
  extract_ms: number;
  resolve_ms: number;
}

export async function readTranscript(transcript: string, x: ReadInput): Promise<ReadResult> {
  const gazetteer = loadGazetteer(x.area.id);
  const extractor = getExtractor();
  // The clip may hold other voices. With one voice this is one reading, as before; when two
  // voices name different places, the speaker is asked which is theirs (lib/geo/voices.ts).
  return readVoices(transcript, {
    extract: (text) => extractor.extract(text, { languageHint: x.sttLanguage, place: x.area.place, language: x.pinned }),
    // About the speaker, or about a track the speaker sees: the words decide, and the resolver places either.
    resolve: (intent, text) => resolveReport({ intent, transcript: text, lastPosition: x.lastPosition, now: x.now, gazetteer, areaCentre: x.area.centre, tracks: x.tracks, observer: x.callsign }),
    gazetteer,
    last: x.lastPosition,
    now: x.now,
    alsoReport: (text) => kindSaid(text) != null || affiliationSaid(text) != null || trackNumberSaid(text) != null,
  });
}
