/** Saving reports and answers to the shared record. Server only. */
import type { AreaId } from "@/lib/geo/areas";
import type { Intent, LastPosition, Resolution } from "@/lib/geo/types";
import { positionFromPlacement, positionFromReport } from "./position";
import { getStore, newEntryId } from "./store";
import type { AnswerEntry, ReportEntry, Timings } from "./types";

export interface ReportInput {
  session: string;
  callsign: string;
  seq: number | null;
  clientTs: number | null;
  area: AreaId;
  transcript: string;
  language: string | null;
  intent: Intent | null;
  resolution: Resolution;
  lastPosition: LastPosition | null;
  timings_ms: Timings;
}

/**
 * Saves one report and returns its id, or null when this coordinator keeps no record. A report
 * sent twice (same call sign, `seq` and client time) is saved once and gets the first id back.
 */
export async function recordReport(input: ReportInput, now = Date.now()): Promise<string | null> {
  const store = getStore();
  if (store.kind === "none") return null;
  if (input.seq != null && input.clientTs != null) {
    const { entries } = await store.list(input.session);
    const dup = entries.find((e) => e.kind === "report" && e.callsign === input.callsign && e.seq === input.seq && e.clientTs === input.clientTs);
    if (dup) return dup.id;
  }
  const entry: ReportEntry = { kind: "report", id: newEntryId(now), ts: now, ...input, position: positionFromReport(input.resolution, input.intent) };
  await store.append(entry);
  return entry.id;
}

export type AnswerResult = { ok: true; entry: AnswerEntry } | { ok: false; status: number; error: string };

/** Saves the speaker's answer to a question: a candidate id, or null for "none of these". */
export async function recordAnswer(session: string, reportId: string, choice: string | null, now = Date.now()): Promise<AnswerResult> {
  const store = getStore();
  if (store.kind === "none") return { ok: false, status: 501, error: "This coordinator keeps no record of reports." };
  const { entries } = await store.list(session);
  const report = entries.find((e): e is ReportEntry => e.kind === "report" && e.id === reportId);
  if (!report) return { ok: false, status: 404, error: "No such report in this session." };
  // Answered already: the first answer stands, and the phone gets it back.
  const earlier = entries.find((e): e is AnswerEntry => e.kind === "answer" && e.report_id === reportId);
  if (earlier) return { ok: true, entry: earlier };
  let position = null;
  if (choice !== null) {
    const c = report.resolution.status === "ambiguous" ? report.resolution.candidates.find((x) => x.id === choice) : undefined;
    if (!c) return { ok: false, status: 400, error: "That choice was not offered." };
    position = positionFromPlacement(c.placement, c.name);
  }
  const entry: AnswerEntry = { kind: "answer", id: newEntryId(now), session, callsign: report.callsign, ts: now, report_id: reportId, choice, position };
  await store.append(entry);
  return { ok: true, entry };
}
