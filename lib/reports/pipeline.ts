/**
 * Reading a transcript for one unit: the model extracts the intent, the resolver places it against
 * the gazetteer from the unit's last position. The report endpoint runs it on every report. A held
 * radio report is read by the model while it waits [256], and the resolver places it again when
 * the operator gives it to a unit [203], since where "200 metres north of me" is depends on who
 * said it. Server only.
 */
import { AREAS, type Area } from "@/lib/geo/areas";
import { loadGazetteer } from "@/lib/geo/gazetteer";
import { splitRequest, type Split } from "@/lib/geo/requests";
import { affiliationSaid, kindSaid, resolveReport, trackNumberSaid, type KnownTrack } from "@/lib/geo/tracks";
import { readPick, type PickHow } from "@/lib/geo/replies";
import type { Candidate, Intent, LastPosition, Resolution } from "@/lib/geo/types";
import { readVoices } from "@/lib/geo/voices";
import { getExtractor, pinnedLanguage } from "@/lib/providers/extractor";
import { foldLog } from "./fold";
import { afterCallsign, withoutClosing } from "./radio";
import type { HeldEntry, LogEntry } from "./types";

/** The resolution saved with a call that was only a request: nothing to place, and no question [234]. */
export const REQUEST_ONLY: Resolution = {
  status: "unresolved",
  candidates: [],
  evidence: { rule: "request_only", detail: "only a request for recon; nothing to place" },
};

/**
 * The resolution sent back when the words were taken as an answer to the unit's open question
 * [251]: nothing is placed by them, and no new question is asked. The command post confirms.
 */
export const ANSWER_HEARD: Resolution = {
  status: "unresolved",
  candidates: [],
  evidence: { rule: "answer_heard", detail: "heard as an answer to the unit's open question; the command post confirms the choice" },
};

/**
 * A few words that answer a unit's open question, and are not a report [251]: "two", "the metro
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
  /** What the model read, by the words it read: kept with a report that is then held [256]. */
  readings: Readings;
}

/**
 * Intents the model read, by the words it read. The model's reading depends only on the words
 * (and the language and area hints), not on who said them, so a held report's reading is kept for
 * when the operator gives it to a unit [256].
 */
export type Readings = Map<string, Promise<Intent>>;

/**
 * An extractor that reads each text once: a text already in `readings`, read or still being read,
 * is not sent to the model again. A reading that failed is dropped, and read again when asked.
 */
export function readOnce(readings: Readings, extract: (text: string) => Promise<Intent>): (text: string) => Promise<Intent> {
  return async (text) => {
    const kept = readings.get(text);
    if (kept) {
      try {
        return await kept;
      } catch {
        // Read again below.
      }
    }
    const reading = extract(text);
    readings.set(text, reading);
    reading.catch(() => {
      if (readings.get(text) === reading) readings.delete(text);
    });
    return reading;
  };
}

export async function readTranscript(transcript: string, x: ReadInput, readings: Readings = new Map()): Promise<ReadResult> {
  const gazetteer = loadGazetteer(x.area.id);
  const extractor = getExtractor();
  // The clip may hold other voices. With one voice this is one reading, as before; when two
  // voices name different places, the speaker is asked which is theirs (lib/geo/voices.ts).
  const read = await readVoices(transcript, {
    extract: readOnce(readings, (text) => extractor.extract(text, { languageHint: x.sttLanguage, place: x.area.place, language: x.pinned })),
    // About the speaker, or about a track the speaker sees: the words decide, and the resolver places either.
    resolve: (intent, text) => resolveReport({ intent, transcript: text, lastPosition: x.lastPosition, now: x.now, gazetteer, areaCentre: x.area.centre, tracks: x.tracks, observer: x.callsign }),
    gazetteer,
    last: x.lastPosition,
    now: x.now,
    alsoReport: (text) => kindSaid(text) != null || affiliationSaid(text) != null || trackNumberSaid(text) != null,
  });
  return { ...read, readings };
}

// ---- a held radio report, read while it waits [256] ----

/**
 * What the model reads of a held report: the words after the call sign heard, with a request for
 * recon cut out [234]. `text` is null when there is nothing to read: no words, or only a request.
 */
export function heldWords(held: Pick<HeldEntry, "transcript" | "heard">): { split: Split; text: string | null } {
  const split = splitRequest(afterCallsign(held.transcript, held.heard));
  return { split, text: held.transcript.trim() && !split.only ? split.text : null };
}

/** The hints a held report is read with, the same when it is read ahead and when it is given. */
export function heldHints(held: Pick<HeldEntry, "language">): Pick<ReadInput, "sttLanguage" | "pinned"> {
  return { sttLanguage: held.language, pinned: pinnedLanguage(held.language) };
}

/** Held reports' readings, by `<session>/<held id>`, oldest first. In memory: a restart reads them again when given. */
const ahead = new Map<string, Readings>();
/** More held reports than an operator would leave waiting. The oldest readings go first. */
const AHEAD_MAX = 200;

const aheadKey = (session: string, held: string) => `${session}/${held}`;

/** The model's readings of a held report, read or still being read, or undefined if there are none. */
export function heldReadings(session: string, held: string): Readings | undefined {
  return ahead.get(aheadKey(session, held));
}

/** Drops a held report's readings once the operator has given or dismissed it. */
export function forgetHeldReadings(session: string, held: string): void {
  ahead.delete(aheadKey(session, held));
}

/**
 * Starts the model reading a held report's words while it waits for the operator [256], so giving
 * it to a unit later only places it. `readings` are what the model read already, for a report held
 * after it was read (`far`). Never throws: a reading that fails is read again when the report is given.
 */
export async function readHeldAhead(held: HeldEntry, readings: Readings = new Map()): Promise<void> {
  const { text } = heldWords(held);
  if (!text) return;
  const key = aheadKey(held.session, held.id);
  ahead.set(key, readings);
  while (ahead.size > AHEAD_MAX) ahead.delete(ahead.keys().next().value!);
  try {
    // No unit yet: the resolver's answer here is thrown away. It is placed again when given.
    await readTranscript(text, { area: AREAS[held.area], ...heldHints(held), lastPosition: null, now: held.ts, tracks: [], callsign: held.read ?? "" }, readings);
  } catch (err) {
    console.error("reading the held report ahead failed", err);
  }
}
