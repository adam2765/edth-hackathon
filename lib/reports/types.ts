/**
 * The shared record: every report a session receives, and every answer to a question, as one
 * append-only log per session. The coordinator writes it; the receiver reads it and rebuilds the
 * map from it, live or up to any moment for a replay. Safe to import on the client.
 */
import type { AreaId } from "@/lib/geo/areas";
import type { HeadingTo, Intent, LastPosition, Resolution } from "@/lib/geo/types";

export type Timings = { stt: number; extract: number; resolve: number; total: number };

/** Where a report leaves the speaker. */
export interface UnitPosition {
  lat: number;
  lon: number;
  radius_m: number;
  /** What the position was placed at, for the marker and the feed ("Bérault", "towards Château de Vincennes"). */
  label: string;
  /** Worked out from the last position and a movement, not from a stated position. Shown with ≈. */
  estimated?: boolean;
  /** For a movement: where the speaker is heading. */
  heading_to?: HeadingTo;
}

export interface ReportEntry {
  kind: "report";
  id: string;
  session: string;
  callsign: string;
  /** The transmitter's own counter; with clientTs it spots a report sent twice. */
  seq: number | null;
  /** Server time when the report was saved, epoch ms. The receiver orders and replays by this. */
  ts: number;
  clientTs: number | null;
  area: AreaId;
  transcript: string;
  language: string | null;
  intent: Intent | null;
  resolution: Resolution;
  /** The last position the transmitter sent with the report: the start of a movement arrow. */
  lastPosition: LastPosition | null;
  /** Where the report puts the speaker; null when it does not move them (a question, could not place). */
  position: UnitPosition | null;
  timings_ms: Timings;
}

export interface AnswerEntry {
  kind: "answer";
  id: string;
  session: string;
  callsign: string;
  ts: number;
  /** The report whose question this answers. */
  report_id: string;
  /** The candidate tapped, or null for "none of these". */
  choice: string | null;
  position: UnitPosition | null;
}

export type LogEntry = ReportEntry | AnswerEntry;

/** `GET /api/sessions/<code>?after=<n>` */
export interface SessionLogReply {
  session: string;
  /** False when this coordinator keeps no record (for now, the hosted site). */
  stored: boolean;
  /** Entries in the log in all; pass it back as `after` to get only newer ones. */
  total: number;
  entries: LogEntry[];
}

const SESSION_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** A session code as stored: lower case, letters, digits, - and _, up to 40 characters. Null if not valid. */
export function sessionCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return SESSION_RE.test(s) ? s : null;
}

/** A call sign as stored: trimmed, single spaces, up to 24 characters. */
export function callsignOf(v: unknown): string {
  if (typeof v !== "string") return "UNKNOWN";
  const s = v.replace(/\s+/g, " ").trim().slice(0, 24);
  return s || "UNKNOWN";
}
