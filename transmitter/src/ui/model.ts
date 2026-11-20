// What the screen shows, as plain data. The logic that fills it lives in App.tsx.
import type { Candidate, Utterance } from "../types";

/** One sent report and what came back. */
export interface Entry {
  id: string;
  ts: number;
  callsign: string;
  source: Utterance["source"];
  /** What the scenario clip says, for comparison with the transcript. */
  scripted?: string;
  transcript: string;
  outcome: string;
  status: "resolved" | "ambiguous" | "unresolved" | "error";
  timings?: string;
  question?: string;
  candidates?: Candidate[];
  /** True while a question is waiting for a choice. */
  pending?: boolean;
}

export type StepResult = { state: "running" | "pass" | "fail"; note: string };

export type Reach = "checking" | "ok" | "unreachable";

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
